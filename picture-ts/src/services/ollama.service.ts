/**
 * Ollama service for API interactions
 * Handles text extraction, chunk combination, and document analysis
 */

import axios from 'axios';
import logger from '../lib/logger';
import { OllamaTextRequest, OllamaImageRequest, OllamaResponse, Role, ProgressTracker } from '../types';
import {
    API_URL,
    DEFAULT_TIMEOUT,
    MAX_RETRIES,
    REQUEST_COOLDOWN,
    VISION_MODEL,
    TEXT_MODEL,
    CHUNK_ANALYSIS_PROMPT,
    CHUNK_COMBINE_PROMPT,
    getPromptByRole
} from '../config';

// Define operation-specific timeouts
const IMAGE_OPERATION_TIMEOUT = 60; // 60 seconds for image operations
const TEXT_OPERATION_TIMEOUT = 300; // 300 seconds for text operations (combining chunks and analysis)

/**
 * Sleep for a specified number of milliseconds
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Base class for Ollama API interactions
 */
export class OllamaService {
    private apiUrl: string;
    private defaultTimeout: number;
    private maxRetries: number;
    private cooldownMs: number;
    private progressTracker: ProgressTracker | null = null;

    /**
     * Create a new OllamaService instance
     * @param apiUrl API URL for Ollama
     * @param timeout Request timeout in seconds
     * @param maxRetries Maximum number of retry attempts
     * @param cooldownMs Cooldown between requests in milliseconds
     */
    constructor(
        apiUrl: string = API_URL,
        timeout: number = DEFAULT_TIMEOUT,
        maxRetries: number = MAX_RETRIES,
        cooldownMs: number = REQUEST_COOLDOWN * 1000
    ) {
        this.apiUrl = apiUrl;
        this.defaultTimeout = timeout;
        this.maxRetries = maxRetries;
        this.cooldownMs = cooldownMs;

        logger.info(`Initialized OllamaService with API URL: ${this.apiUrl}`);
    }

    /**
     * Set the progress tracker
     * @param tracker Progress tracker instance
     */
    setProgressTracker(tracker: ProgressTracker): void {
        this.progressTracker = tracker;
    }

    /**
     * Make a text request to the Ollama API
     * @param model Model name
     * @param prompt Text prompt
     * @param isLongOperation Whether this is a long operation (chunk combining or document analysis)
     * @returns Promise resolving to the model's response
     */
    private async makeTextRequest(model: string, prompt: string, isLongOperation: boolean = false): Promise<string> {
        const payload: OllamaTextRequest = {
            model,
            prompt,
            stream: false,
            options: {
                temperature: 0.1 // Low temperature for more deterministic outputs
            }
        };

        // Use longer timeout for chunk combining and document analysis
        const timeout = isLongOperation ? TEXT_OPERATION_TIMEOUT : this.defaultTimeout;
        return this.makeRequest(payload, timeout);
    }

    /**
     * Make an image request to the Ollama API
     * @param model Model name
     * @param prompt Text prompt
     * @param imageBase64 Base64-encoded image
     * @returns Promise resolving to the model's response
     */
    private async makeImageRequest(model: string, prompt: string, imageBase64: string): Promise<string> {
        const payload: OllamaImageRequest = {
            model,
            prompt,
            stream: false,
            images: [imageBase64],
            options: {}
        };

        return this.makeRequest(payload, IMAGE_OPERATION_TIMEOUT);
    }

    /**
     * Make a request to the Ollama API with retry logic
     * @param payload Request payload
     * @param timeoutSeconds Timeout in seconds for this request
     * @returns Promise resolving to the model's response
     */
    private async makeRequest(payload: OllamaTextRequest | OllamaImageRequest, timeoutSeconds: number): Promise<string> {
        let attempts = 0;
        let lastError: Error | null = null;

        // Enable streaming for better token rate tracking
        const useStreaming = true;
        if (useStreaming) {
            payload.stream = true;
        }

        while (attempts < this.maxRetries) {
            try {
                // If this is a retry, wait before making the request
                if (attempts > 0) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
                    logger.info(`Retry attempt ${attempts}/${this.maxRetries}, waiting ${backoffMs}ms...`);
                    await sleep(backoffMs);
                }

                logger.debug(`Making request to ${this.apiUrl} with model ${payload.model} (timeout: ${timeoutSeconds}s)`);

                if (useStreaming) {
                    // Handle streaming response
                    const response = await axios.post(
                        this.apiUrl,
                        payload,
                        {
                            headers: { 'Content-Type': 'application/json' },
                            timeout: timeoutSeconds * 1000,
                            responseType: 'stream'
                        }
                    );

                    // Process the stream
                    let fullResponse = '';
                    return new Promise<string>((resolve, reject) => {
                        response.data.on('data', (chunk: Buffer) => {
                            try {
                                const text = chunk.toString();
                                const lines = text.split('\n').filter(line => line.trim());

                                for (const line of lines) {
                                    try {
                                        const data = JSON.parse(line);
                                        if (data.response) {
                                            fullResponse += data.response;

                                            // Update progress tracker with new tokens
                                            if (this.progressTracker && data.response.length > 0) {
                                                this.progressTracker.updateTokens(data.response.length);
                                            }
                                        }
                                    } catch (e) {
                                        // Ignore JSON parse errors
                                    }
                                }
                            } catch (e) {
                                // Ignore errors in stream processing
                            }
                        });

                        response.data.on('end', () => {
                            // Apply cooldown between requests to avoid rate limiting
                            sleep(this.cooldownMs).then(() => {
                                resolve(fullResponse);
                            });
                        });

                        response.data.on('error', (err: Error) => {
                            reject(err);
                        });
                    });
                } else {
                    // Handle non-streaming response
                    const response = await axios.post<OllamaResponse>(
                        this.apiUrl,
                        payload,
                        {
                            headers: { 'Content-Type': 'application/json' },
                            timeout: timeoutSeconds * 1000
                        }
                    );

                    // Apply cooldown between requests to avoid rate limiting
                    await sleep(this.cooldownMs);

                    return response.data.response;
                }
            } catch (error) {
                attempts++;
                lastError = error as Error;

                logger.error(`Error making request (attempt ${attempts}/${this.maxRetries}): ${error}`);

                // If we've exhausted all retries, throw the error
                if (attempts >= this.maxRetries) {
                    throw new Error(`Failed after ${this.maxRetries} attempts: ${lastError.message}`);
                }
            }
        }

        // This should never happen due to the throw above, but TypeScript needs it
        throw new Error(`Unexpected error: ${lastError?.message || 'Unknown error'}`);
    }

    /**
     * Extract text from an image chunk using the vision model
     * @param chunk Image chunk as a Buffer
     * @returns Promise resolving to the extracted text
     */
    async extractTextFromChunk(chunk: Buffer): Promise<string> {
        try {
            logger.info('Extracting text from image chunk');

            // Convert image buffer to base64
            const base64Image = chunk.toString('base64');

            // Create a payload that includes the image
            const payload: OllamaImageRequest = {
                model: VISION_MODEL,
                prompt: CHUNK_ANALYSIS_PROMPT,
                stream: false,
                images: [base64Image],
                options: {}
            };

            // Make the request directly to ensure token rate reporting
            const result = await this.makeRequest(payload, IMAGE_OPERATION_TIMEOUT);

            logger.debug('Successfully extracted text from image chunk');
            return result;
        } catch (error) {
            logger.error(`Error extracting text from chunk: ${error}`);
            throw error;
        }
    }

    /**
     * Combine multiple text chunks into a single coherent document
     * @param texts Array of extracted text chunks
     * @returns Promise resolving to the combined document
     */
    async combineChunks(texts: string[]): Promise<string> {
        try {
            if (texts.length === 0) {
                logger.warn('No text chunks to combine');
                return '';
            }

            if (texts.length === 1) {
                logger.info('Only one text chunk, no need to combine');
                return texts[0];
            }

            logger.info(`Combining ${texts.length} text chunks`);

            // Build the prompt with all text chunks
            const combinedTexts = texts.map((text, i) => `CHUNK ${i + 1}:\n${text}`).join('\n\n');
            const prompt = `${CHUNK_COMBINE_PROMPT}\n\nHere are the text chunks extracted from the image:\n\n${combinedTexts}`;

            // Make the request to the text model with longer timeout
            const result = await this.makeTextRequest(
                TEXT_MODEL,
                prompt,
                true // This is a long operation
            );

            logger.debug('Successfully combined text chunks');
            return result;
        } catch (error) {
            logger.error(`Error combining text chunks: ${error}`);
            throw error;
        }
    }

    /**
     * Analyze a document using a role-specific prompt
     * @param document The document to analyze
     * @param role The role to use for analysis
     * @returns Promise resolving to the analysis result
     */
    async analyzeDocument(document: string, role: Role): Promise<string> {
        try {
            logger.info(`Analyzing document with role: ${role}`);

            // Get the appropriate prompt for the specified role
            const prompt = getPromptByRole(role);

            // Build the full prompt with the document
            const fullPrompt = `${prompt}\n\nDocument to analyze:\n\n${document}`;

            // Make the request to the text model with longer timeout
            const result = await this.makeTextRequest(
                TEXT_MODEL,
                fullPrompt,
                true // This is a long operation
            );

            logger.debug('Successfully analyzed document');
            return result;
        } catch (error) {
            logger.error(`Error analyzing document: ${error}`);
            throw error;
        }
    }
}

// Export a singleton instance
export default new OllamaService(); 