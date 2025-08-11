/**
 * Pipeline service for orchestrating the image analysis workflow
 * Coordinates image validation, chunking, text extraction, combination, and analysis
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import logger from '../lib/logger';
import { validateImage, chunkImage, saveImageChunks, getImageDimensions } from './image.service';
import ollamaService from './ollama.service';
import { AnalyzeCommandArgs, OcrCommandArgs, Role, ProgressTracker } from '../types';
import { DEFAULT_OUTPUT_DIR } from '../config';
import { createProgressTracker } from '../lib/ui';

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
            save,
            output,
            chunkSize,
            overlap,
            forceChunk,
            saveChunks
        } = args;

        logger.info(`Starting OCR pipeline for image: ${imagePath}`);

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

            // Chunk the image
            logger.info(`Chunking image with max dimension ${chunkSize || 'default'} and overlap ${overlap || 'default'}`);

            let chunks;
            try {
                chunks = await chunkImage(
                    imagePath,
                    chunkSize,
                    overlap,
                );
            } catch (chunkError) {
                logger.error(`Failed to chunk image: ${chunkError}`);
                // Try again with smaller chunk size if the original failed
                if (!chunkSize || chunkSize > 800) {
                    logger.info('Trying again with smaller chunk size (800px)');
                    chunks = await chunkImage(
                        imagePath,
                        800, // Smaller chunk size
                        overlap,
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
                    title: 'Overall chunk processing progress',
                    showTokensPerSecond: false, // This is just for overall progress
                    showTimeElapsed: args.showTimeElapsed
                });
            }

            // Process each chunk sequentially to avoid overwhelming the API
            // Collect texts along with positions for stable ordering and overlap handling
            const rawChunkTexts: { text: string; x: number; y: number }[] = [];
            let successfulChunks = 0;

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                logger.info(`Processing chunk ${i + 1}/${chunks.length}`);

                try {
                    // Start a new progress tracker for this chunk
                    if (this.progressTracker) {
                        this.progressTracker.start({
                            style: args.noProgress ? 'none' : args.progress || 'spinner',
                            title: `Extracting text from chunk ${i + 1}/${chunks.length}`,
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
                        rawChunkTexts.push({ text: extractedText, x: chunk.position.x, y: chunk.position.y });
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

            // Pre-filter: drop low-signal chunks (simple alnum ratio threshold)
            const alnumRatio = (s: string) => {
                const letters = (s.match(/[A-Za-z0-9]/g) || []).length;
                return letters / Math.max(1, s.length);
            };
            const PREFILTER_MIN_ALNUM = 0.2;
            const PLACEHOLDER_RE = /^(empty|no\s*text|blank|none|n\/a|na)$/i;
            const filteredBase = rawChunkTexts.filter(ct => alnumRatio(ct.text) >= PREFILTER_MIN_ALNUM && !PLACEHOLDER_RE.test(ct.text.trim()))
                .map(ct => ({ ...ct, text: ct.text.replace(/[\u0000-\u001F]+/g, '').trimEnd() }));
            // Deduplicate identical texts to reduce repeated placeholders or duplicates
            const seen = new Set<string>();
            const filtered: { text: string; x: number; y: number }[] = [];
            for (const ct of filteredBase) {
                const key = ct.text;
                if (!seen.has(key)) {
                    seen.add(key);
                    filtered.push(ct);
                }
            }
            if (filtered.length < rawChunkTexts.length) {
                logger.info(`Prefilter dropped ${rawChunkTexts.length - filtered.length} low-signal chunks`);
            }

            // If too many chunks are empty, fall back to a single full-image OCR pass
            const emptyRatio = 1 - (filtered.length / chunks.length);
            let fallbackText: string | null = null;
            if (emptyRatio >= 0.8) {
                logger.warn(`High empty ratio from chunks (${(emptyRatio * 100).toFixed(0)}%). Attempting full-image OCR fallback.`);
                try {
                    const buf = await sharp(imagePath)
                        .flatten({ background: { r: 255, g: 255, b: 255 } })
                        .png()
                        .toBuffer();
                    const text = await ollamaService.extractTextFromChunk(buf);
                    const ok = text && !PLACEHOLDER_RE.test(text.trim()) && alnumRatio(text) >= PREFILTER_MIN_ALNUM;
                    if (ok) {
                        fallbackText = text.trimEnd();
                        logger.info(`Full-image OCR fallback produced ${fallbackText.length} chars.`);
                    } else {
                        logger.warn('Full-image OCR fallback did not produce usable text.');
                    }
                } catch (e) {
                    logger.error(`Full-image OCR fallback failed: ${e}`);
                }
            }

            // Sort by position (y then x)
            filtered.sort((a, b) => (a.y - b.y) || (a.x - b.x));

            // Prepare ordered texts only for LLM combine
            let orderedTexts = filtered.map(ct => ct.text);
            let usedFallback = false;
            if (orderedTexts.length === 0 && fallbackText) {
                orderedTexts = [fallbackText];
                usedFallback = true;
                logger.info(`Using full-image OCR fallback as final OCR input (len=${fallbackText.length}).`);
            }

            // Combine all chunks into a single document
            logger.info('Combining extracted text from all chunks');
            if (this.progressTracker) {
                this.progressTracker.finish('Text extraction complete');
                this.progressTracker.start({
                    style: args.noProgress ? 'none' : args.progress || 'spinner',
                    title: 'Combining text chunks',
                    // Always show tokens per second for LLM operations
                    showTokensPerSecond: true,
                    showTimeElapsed: args.showTimeElapsed
                });
            }

            // Determine if we have enough content to justify LLM combine
            const sumInputsPre = orderedTexts.reduce((n, s) => n + s.length, 0);
            const enoughChunks = orderedTexts.length >= 2;
            const enoughChars = sumInputsPre >= 200;
            let combinedText: string;
            if (usedFallback) {
                // Use the fallback text directly as the final OCR result
                combinedText = orderedTexts[0];
                logger.info('Skipped LLM combine due to fallback text usage.');
            } else if (enoughChunks && enoughChars) {
                combinedText = await ollamaService.combineChunks(orderedTexts);
            } else {
                combinedText = 'EMPTY';
            }

            if (this.progressTracker) {
                this.progressTracker.finish('Text combination complete');
            }

            // Expansion cap telemetry: compare combined length to sum of inputs
            const sumInputs = orderedTexts.reduce((n, s) => n + s.length, 0);
            const expansionRatio = sumInputs > 0 ? combinedText.length / sumInputs : 1;
            logger.info(`Combine expansion ratio: ${expansionRatio.toFixed(3)} (sum_inputs=${sumInputs}, output=${combinedText.length})`);

            // Save the result if requested
            if (save && output) {
                await this.saveResult(combinedText, output, 'ocr_result.md');

                // Also save individual chunk texts for debugging if needed
                if (rawChunkTexts.length > 0) {
                    const chunksDir = path.join(this.getOutputDir(output), 'chunk_texts');
                    await fs.mkdir(chunksDir, { recursive: true });
                    for (let i = 0; i < rawChunkTexts.length; i++) {
                        const chunkPath = path.join(chunksDir, `chunk_${i.toString().padStart(3, '0')}.md`);
                        await fs.writeFile(chunkPath, rawChunkTexts[i].text || 'EMPTY', 'utf-8');
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
        const { path: imagePath, role = 'marketing', save, output } = args;

        logger.info(`Starting analysis pipeline for image: ${imagePath} with role: ${role}`);

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
                    title: `Analyzing document with ${role} role`,
                    // Always show tokens per second for LLM operations
                    showTokensPerSecond: true,
                    showTimeElapsed: args.showTimeElapsed
                });
            }

            logger.info(`Analyzing document with role: ${role}`);
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