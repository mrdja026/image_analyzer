/**
 * Pipeline service for orchestrating the image analysis workflow
 * Coordinates image validation, chunking, text extraction, combination, and analysis
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '../lib/logger';
import { validateImage, chunkImage, saveImageChunks, getImageDimensions } from './image.service';
import ollamaService from './ollama.service';
import { AnalyzeCommandArgs, OcrCommandArgs, Role, ProgressTracker } from '../types';
import { DEFAULT_OUTPUT_DIR } from '../config';
import { createProgressTracker } from '../lib/ui';
import sharp from 'sharp';
import { calculateOptimalChunks } from './image.service';

// Constants for warning thresholds
const LARGE_IMAGE_WARNING_DIM = 5000; // Dimensions above which to warn about large images

/**
 * Pipeline service for orchestrating the image analysis workflow
 */
export class PipelineService {
    private progressTracker: ProgressTracker | null = null;

    /**
 * Create a new PipelineService instance
 * @param progressTracker Optional progress tracker for displaying progress
 */
    constructor(progressTracker?: ProgressTracker) {
        this.progressTracker = progressTracker || createProgressTracker();
    }

    /**
     * Set the progress tracker
     * @param tracker Progress tracker instance
     */
    setProgressTracker(tracker: ProgressTracker): void {
        this.progressTracker = tracker;
    }

    /**
     * Run the OCR extraction pipeline
     * @param args Command arguments
     * @returns Promise resolving to the extracted text
     */
    async runOcrPipeline(args: OcrCommandArgs): Promise<string> {
        const {
            path: imagePath,
            mode,
            save,
            output,
            chunkSize,
            overlap,
            forceChunk,
            saveChunks,
            useGridChunking
        } = args;

        logger.info(`Starting OCR pipeline for image: ${imagePath}${mode ? ` (mode: ${mode})` : ''}`);

        try {
            // Validate the image
            const isValid = await validateImage(imagePath);
            if (!isValid) {
                throw new Error(`Invalid image: ${imagePath}`);
            }

            // Check image dimensions and warn if very large
            const dimensions = await getImageDimensions(imagePath);
            if (dimensions) {
                const [width, height] = dimensions;
                if (width > LARGE_IMAGE_WARNING_DIM || height > LARGE_IMAGE_WARNING_DIM) {
                    logger.warn(`Processing very large image (${width}x${height}). This may take longer and require more memory.`);
                }
            }

            // Chunk the image using grid-based chunking only
            logger.info(`Chunking image with max dimension ${chunkSize || 'default'} and overlap ${overlap || 'default'}${mode ? `, mode ${mode}` : ''}`);

            let chunks;
            try {
                // All chunking is now grid-based using the chunkImage function which has been simplified
                chunks = await chunkImage(
                    imagePath,
                    chunkSize,
                    overlap
                );
            } catch (chunkError) {
                logger.error(`Failed to chunk image: ${chunkError}`);
                // Try again with smaller chunk size if the original failed
                if (!chunkSize || chunkSize > 800) {
                    logger.info('Trying again with smaller chunk size (800px)');

                    // Use a smaller chunk size
                    chunks = await chunkImage(
                        imagePath,
                        800, // Smaller chunk size
                        overlap
                    );
                } else {
                    throw chunkError;
                }
            }

            if (chunks.length === 0) {
                throw new Error('No valid image chunks were generated');
            }

            logger.info(`Successfully generated ${chunks.length} chunks for processing`);

            // Pass the progress tracker to the ollama service
            if (this.progressTracker) {
                ollamaService.setProgressTracker(this.progressTracker);
            }

            // Initialize overall progress tracker if available
            if (this.progressTracker) {
                this.progressTracker.start({
                    style: args.noProgress ? 'none' : args.progress || 'spinner',
                    total: chunks.length,
                    title: `Overall chunk processing progress${mode ? ` (${mode})` : ''}`,
                    showTokensPerSecond: false, // This is just for overall progress
                    showTimeElapsed: args.showTimeElapsed
                });
            }

            // Process each chunk sequentially to avoid overwhelming the API
            const rawChunkTexts: string[] = [];
            let successfulChunks = 0;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                logger.info(`Processing chunk ${i + 1}/${chunks.length}`);

                try {
                    // Start a new progress tracker for this chunk
                    if (this.progressTracker) {
                        this.progressTracker.start({
                            style: args.noProgress ? 'none' : args.progress || 'spinner',
                            title: `Extracting text from chunk ${i + 1}/${chunks.length}${mode ? ` (${mode})` : ''}`,
                            showTokensPerSecond: true,
                            showTimeElapsed: args.showTimeElapsed
                        });
                    }

                    // Extract text from the chunk
                    const extractedText = await ollamaService.extractTextFromChunk(chunk.data);

                    // Finish the progress tracker for this chunk
                    if (this.progressTracker) {
                        this.progressTracker.finish(`Completed chunk ${i + 1}/${chunks.length}`);
                    }

                    if (extractedText && extractedText.trim()) {
                        rawChunkTexts.push(extractedText);
                        successfulChunks++;
                    } else {
                        logger.warn(`Chunk ${i + 1} produced empty text result`);
                    }
                } catch (extractError) {
                    logger.error(`Error extracting text from chunk ${i + 1}: ${extractError}`);
                    // Continue with next chunk
                    if (this.progressTracker) {
                        this.progressTracker.finish(`Error processing chunk ${i + 1}/${chunks.length}`);
                    }
                }

                // Update overall progress
                if (this.progressTracker) {
                    // Update the overall progress
                    this.progressTracker.update(i + 1);
                }
            }

            logger.info(`Successfully extracted text from ${successfulChunks}/${chunks.length} chunks`);

            // Finish the overall progress tracker
            if (this.progressTracker) {
                this.progressTracker.finish(`Processed ${successfulChunks}/${chunks.length} chunks successfully`);
            }

            if (rawChunkTexts.length === 0) {
                throw new Error('No text could be extracted from any image chunks');
            }

            // Combine all chunks into a single document
            logger.info('Combining extracted text from all chunks');
            if (this.progressTracker) {
                this.progressTracker.finish(`Text extraction complete${mode ? ` (${mode})` : ''}`);
                this.progressTracker.start({
                    style: args.noProgress ? 'none' : args.progress || 'spinner',
                    title: `Combining text chunks${mode ? ` (${mode})` : ''}`,
                    // Always show tokens per second for LLM operations
                    showTokensPerSecond: true,
                    showTimeElapsed: args.showTimeElapsed
                });
            }

            const combinedText = await ollamaService.combineChunks(rawChunkTexts);

            if (this.progressTracker) {
                this.progressTracker.finish('Text combination complete');
            }

            // Save the result if requested
            if (save && output) {
                await this.saveResult(combinedText, output, 'ocr_result.md');

                // Also save individual chunk texts for debugging if needed
                if (rawChunkTexts.length > 1) {
                    const chunksDir = path.join(this.getOutputDir(output), 'chunk_texts');
                    await fs.mkdir(chunksDir, { recursive: true });

                    for (let i = 0; i < rawChunkTexts.length; i++) {
                        const chunkPath = path.join(chunksDir, `chunk_${i.toString().padStart(3, '0')}.md`);
                        await fs.writeFile(chunkPath, rawChunkTexts[i], 'utf-8');
                    }
                    logger.info(`Saved ${rawChunkTexts.length} individual chunk texts to ${chunksDir}`);
                }
            }

            return combinedText;
        } catch (error) {
            logger.error(`Error in OCR pipeline: ${error}`);
            throw error;
        }
    }

    /**
     * Run the full analysis pipeline (OCR + analysis)
     * @param args Command arguments
     * @returns Promise resolving to the analysis result
     */
    async runAnalysisPipeline(args: AnalyzeCommandArgs): Promise<string> {
        const { path: imagePath, role = 'marketing', save, output, mode } = args;

        logger.info(`Starting analysis pipeline for image: ${imagePath} with role: ${role}${mode ? ` (mode: ${mode})` : ''}`);

        try {
            // First run the OCR pipeline to get the combined text
            const combinedText = await this.runOcrPipeline({
                ...args,
                // Always show tokens per second for LLM operations
                showTokensPerSecond: true
            });

            // Then analyze the document with the specified role
            if (this.progressTracker) {
                this.progressTracker.start({
                    style: args.noProgress ? 'none' : args.progress || 'spinner',
                    title: `Analyzing document with ${role} role${mode ? ` (${mode})` : ''}`,
                    // Always show tokens per second for LLM operations
                    showTokensPerSecond: true,
                    showTimeElapsed: args.showTimeElapsed
                });
            }

            logger.info(`Analyzing document with role: ${role}${mode ? ` (mode: ${mode})` : ''}`);
            const analysisResult = await ollamaService.analyzeDocument(combinedText, role);

            if (this.progressTracker) {
                this.progressTracker.finish('Analysis complete');
            }

            // Save the result if requested
            if (save && output) {
                await this.saveResult(analysisResult, output, `analysis_${role}.md`);
                // Also save the raw OCR result
                await this.saveResult(combinedText, output, 'ocr_result.md');
            }

            return analysisResult;
        } catch (error) {
            logger.error(`Error in analysis pipeline: ${error}`);
            throw error;
        }
    }

    /**
     * Get the output directory path
     * @param outputDir User-specified output directory or default
     * @returns Path to the output directory
     */
    private getOutputDir(outputDir?: string): string {
        const dir = outputDir || DEFAULT_OUTPUT_DIR;
        return path.resolve(process.cwd(), dir);
    }

    /**
     * Save a result to a file
     * @param content Content to save
     * @param outputDir Output directory
     * @param filename Filename
     * @returns Promise resolving when the file is saved
     */
    private async saveResult(content: string, outputDir: string, filename: string): Promise<void> {
        try {
            const dir = this.getOutputDir(outputDir);
            await fs.mkdir(dir, { recursive: true });

            const filePath = path.join(dir, filename);
            await fs.writeFile(filePath, content, 'utf-8');

            logger.info(`Saved result to ${filePath}`);
        } catch (error) {
            logger.error(`Error saving result: ${error}`);
            throw error;
        }
    }
}

// Export a singleton instance
export default new PipelineService(); 