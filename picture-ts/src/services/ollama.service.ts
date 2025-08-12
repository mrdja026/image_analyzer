/**
 * Ollama service for API interactions.
 * This version uses a unified, robust request pipeline.
 */

import axios from 'axios';
import logger from '../lib/logger';
import { OllamaRequest, OllamaResponse, Role } from '../types';
import {
    API_URL,
    MAX_RETRIES,
    REQUEST_COOLDOWN,
    TEXT_MODEL,
    CHUNK_COMBINE_PROMPT,
    getPromptByRole,
    TEXT_OPERATION_TIMEOUT
} from '../config';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class OllamaService {
    private progressTracker: { updateTokens(tokens: number): void } | null = null;

    constructor() {
        logger.info(`Initialized OllamaService with API URL: ${API_URL}`);
    }

    public setProgressTracker(tracker: { updateTokens(tokens: number): void } | null): void {
        this.progressTracker = tracker;
    }

    /**
     * The single, unified method for making any request to the Ollama API.
     * It handles streaming, retries, and progress tracking.
     */
    private async makeRequest(payload: OllamaRequest, timeoutSeconds: number): Promise<string> {
        let attempts = 0;
        payload.stream = true; // Always stream for progress tracking

        while (attempts < MAX_RETRIES) {
            try {
                if (attempts > 0) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempts), 10000);
                    logger.info(`Retry attempt ${attempts + 1}/${MAX_RETRIES}, waiting ${backoffMs}ms...`);
                    await sleep(backoffMs);
                }

                logger.debug(`Making request to ${API_URL} with model ${payload.model}`);

                const response = await axios.post(API_URL, payload, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: timeoutSeconds * 1000,
                    responseType: 'stream'
                });

                let fullResponse = '';
                return new Promise<string>((resolve, reject) => {
                    response.data.on('data', (chunk: Buffer) => {
                        try {
                            const lines = chunk.toString().split('\n').filter(line => line.trim());
                            for (const line of lines) {
                                const data: OllamaResponse = JSON.parse(line);
                                if (data.response) {
                                    fullResponse += data.response;
                                    this.progressTracker?.updateTokens(data.response.length);
                                }
                            }
                        } catch (e) { /* Ignore parsing errors for incomplete stream chunks */ }
                    });
                    response.data.on('end', () => {
                        sleep(REQUEST_COOLDOWN * 1000).then(() => resolve(fullResponse));
                    });
                    response.data.on('error', reject);
                });

            } catch (error) {
                attempts++;
                logger.error(`Error making request (attempt ${attempts}/${MAX_RETRIES}): ${error}`);
                if (attempts >= MAX_RETRIES) {
                    throw new Error(`Failed after ${MAX_RETRIES} attempts: ${(error as Error).message}`);
                }
            }
        }
        throw new Error("Ollama request failed after all retries."); // Should be unreachable
    }

    /**
     * A clean, simple wrapper for combining text chunks.
     */
    public async combineChunks(texts: string[]): Promise<string> {
        if (texts.length === 0) return '';
        if (texts.length === 1) return texts[0];

        const combinedTexts = texts.map((text, i) => `--- CHUNK ${i + 1} ---\n${text}`).join('\n\n');
        const prompt = CHUNK_COMBINE_PROMPT.replace('{chunks_text}', combinedTexts);

        const payload: OllamaRequest = {
            model: TEXT_MODEL,
            prompt: prompt,
            options: { temperature: 0.1 }
        };
        return this.makeRequest(payload, TEXT_OPERATION_TIMEOUT);
    }

    /**
     * A clean, simple wrapper for analyzing a document with a specific role.
     */
    public async analyzeDocument(document: string, role: Role): Promise<string> {
        const rolePrompt = getPromptByRole(role);
        const prompt = rolePrompt.replace('{document_text}', document);

        const payload: OllamaRequest = {
            model: TEXT_MODEL,
            prompt: prompt,
            options: { temperature: 0.1 }
        };
        return this.makeRequest(payload, TEXT_OPERATION_TIMEOUT);
    }
}

export default new OllamaService();