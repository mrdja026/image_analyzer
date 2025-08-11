/**
 * Pipeline service for orchestrating the image analysis workflow.
 * This version includes a corrected, robust, end-to-end pipeline logic.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import sharp from 'sharp';
import logger from '../lib/logger';
import { validateImage, chunkImage, getImageDimensions, preprocessChunkForOcr } from './image.service';
import ollamaService from './ollama.service';
import { AnalyzeCommandArgs, OcrCommandArgs, Role, ProgressTracker } from '../types';
import { DEFAULT_OUTPUT_DIR } from '../config';
import { createProgressTracker } from '../lib/ui';

const LARGE_IMAGE_WARNING_DIM = 5000;

export class PipelineService {
    private progressTracker: ProgressTracker | null = null;

    constructor(progressTracker?: ProgressTracker) {
        this.progressTracker = progressTracker || createProgressTracker();
    }

    setProgressTracker(tracker: ProgressTracker): void {
        this.progressTracker = tracker;
    }

    async runOcrPipeline(args: OcrCommandArgs): Promise<string> {
        const { path: imagePath, save, output, chunkSize, overlap, debug } = args;
        logger.info(`Starting OCR pipeline for image: ${imagePath}`);

        if (!await validateImage(imagePath)) {
            throw new Error(`Invalid image: ${imagePath}`);
        }

        const dimensions = await getImageDimensions(imagePath);
        if (dimensions && (dimensions[0] > LARGE_IMAGE_WARNING_DIM || dimensions[1] > LARGE_IMAGE_WARNING_DIM)) {
            logger.warn(`Processing very large image (${dimensions[0]}x${dimensions[1]}). This may take longer.`);
        }

        const chunks = await chunkImage(imagePath, chunkSize, overlap, debug);
        if (chunks.length === 0) {
            throw new Error('No valid image chunks were generated.');
        }
        logger.info(`Successfully generated ${chunks.length} chunks for processing.`);

        if (this.progressTracker) {
            ollamaService.setProgressTracker(this.progressTracker);
            this.progressTracker.start({
                style: args.noProgress ? 'none' : args.progress || 'spinner',
                total: chunks.length,
                title: 'Overall Chunk Processing',
            });
        }

        const rawChunkTexts: { text: string; x: number; y: number }[] = [];

        // --- START OF THE CRITICAL LOGIC FIX ---
        for (const chunk of chunks) {
            const i = chunk.index;
            logger.info(`Processing chunk ${i + 1}/${chunks.length}`);

            try {
                if (this.progressTracker) {
                    this.progressTracker.start({
                        style: args.noProgress ? 'none' : args.progress || 'spinner',
                        title: `Extracting text from chunk ${i + 1}/${chunks.length}`,
                        showTokensPerSecond: true,
                    });
                }

                // 1. Preprocess the chunk's image data first.
                const processedChunkData = await preprocessChunkForOcr(chunk.data);

                // 2. Send the PROCESSED data to the OCR model.
                const extractedText = await ollamaService.extractTextFromChunk(processedChunkData);

                if (this.progressTracker) {
                    this.progressTracker.finish(`Completed chunk ${i + 1}/${chunks.length}`);
                }

                if (extractedText && extractedText.trim()) {
                    rawChunkTexts.push({ text: extractedText, x: chunk.position.x, y: chunk.position.y });
                } else {
                    logger.warn(`Chunk ${i + 1} produced an empty text result.`);
                }

            } catch (error) {
                logger.error(`Error processing chunk ${i + 1}: ${error}`);
                if (this.progressTracker) {
                    this.progressTracker.finish(`Error processing chunk ${i + 1}/${chunks.length}`);
                }
            }
            if (this.progressTracker) {
                this.progressTracker.update(i + 1);
            }
        }
        // --- END OF THE CRITICAL LOGIC FIX ---

        if (this.progressTracker) {
            this.progressTracker.finish(`Processed ${chunks.length} chunks.`);
        }

        if (rawChunkTexts.length === 0) {
            logger.warn('No text could be extracted from any chunks. The document may be empty.');
            return "Error: No text could be extracted from the image.";
        }

        // Combine the clean texts.
        const orderedTexts = rawChunkTexts
            .sort((a, b) => (a.y - b.y) || (a.x - b.x))
            .map(ct => ct.text);

        logger.info('Combining extracted text...');
        const combinedText = await ollamaService.combineChunks(orderedTexts);

        if (save && output) {
            await this.saveResults(combinedText, rawChunkTexts, output);
        }

        return combinedText;
    }

    async runAnalysisPipeline(args: AnalyzeCommandArgs): Promise<string> {
        const { role = 'marketing', save, output } = args;
        logger.info(`Starting analysis pipeline for image: ${args.path} with role: ${role}`);

        const combinedText = await this.runOcrPipeline(args);

        if (combinedText.startsWith("Error:")) {
            return combinedText;
        }

        logger.info(`Analyzing document with role: ${role}`);
        const analysisResult = await ollamaService.analyzeDocument(combinedText, role);

        if (save && output) {
            await this.saveResult(analysisResult, output, `analysis_${role}.md`);
        }

        return analysisResult;
    }

    private getOutputDir(outputDir?: string): string {
        return path.resolve(process.cwd(), outputDir || DEFAULT_OUTPUT_DIR);
    }

    private async saveResult(content: string, outputDir: string, filename: string): Promise<void> {
        try {
            const dir = this.getOutputDir(outputDir);
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, filename);
            await fs.writeFile(filePath, content, 'utf-8');
            logger.info(`Saved result to ${filePath}`);
        } catch (error) {
            logger.error(`Error saving result to ${filename}: ${error}`);
        }
    }

    private async saveResults(combinedText: string, rawChunks: { text: string }[], outputDir: string): Promise<void> {
        await this.saveResult(combinedText, outputDir, 'ocr_result.md');
        const chunksDir = path.join(this.getOutputDir(outputDir), 'chunk_texts');
        await fs.mkdir(chunksDir, { recursive: true });
        for (let i = 0; i < rawChunks.length; i++) {
            const chunkPath = path.join(chunksDir, `chunk_${i.toString().padStart(3, '0')}.md`);
            await fs.writeFile(chunkPath, rawChunks[i].text || 'EMPTY', 'utf-8');
        }
        logger.info(`Saved ${rawChunks.length} individual chunk texts to ${chunksDir}`);
    }
}

export default new PipelineService();