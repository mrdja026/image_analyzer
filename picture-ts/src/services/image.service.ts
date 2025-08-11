/**
 * Image service for validation, content-aware chunking, and preprocessing.
 * This is the complete, corrected, and final version.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import cv from '@techstark/opencv-js';
import logger from '../lib/logger';
import { ImageChunk, SupportedImageFormat } from '../types';
import {
    MAX_IMAGE_SIZE,
    SUPPORTED_FORMATS,
    DEFAULT_CHUNK_MAX_DIM,
    DEFAULT_CHUNK_OVERLAP,
    ENABLE_OPENCV,
    OPENCV_DEBUG_EXPORT,
    OPENCV_MIN_BLOCK_W,
    OPENCV_MIN_BLOCK_H,
    OPENCV_MAX_WIDTH_FRAC,
    DISABLE_BLOCK_MERGE,
    ENABLE_CHUNK_PREPROCESS
} from '../config';
import { getOpenCV } from '../lib/opencv';

async function loadOpenCV(): Promise<any> { return getOpenCV(); }

// --- RESTORED CRITICAL FUNCTION ---
/**
 * Preprocesses an image chunk for OCR to improve clarity and accuracy.
 * @param chunk The raw image buffer of a chunk.
 * @returns A promise resolving to the preprocessed image buffer.
 */
export async function preprocessChunkForOcr(chunk: Buffer): Promise<Buffer> {
    if (!ENABLE_OPENCV || !ENABLE_CHUNK_PREPROCESS) {
        return chunk;
    }
    try {
        const cv = await loadOpenCV();
        const img = sharp(chunk);
        const metadata = await img.metadata();
        if (!metadata.width || !metadata.height) return chunk;

        const raw = await img.ensureAlpha().raw().toBuffer();
        const src = new cv.Mat(metadata.height, metadata.width, cv.CV_8UC4);
        src.data.set(raw);

        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        const blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

        const equalized = new cv.Mat();
        cv.equalizeHist(blurred, equalized);

        const outBuffer = await sharp(Buffer.from(equalized.data), {
            raw: { width: equalized.cols, height: equalized.rows, channels: 1 }
        }).png().toBuffer();

        src.delete(); gray.delete(); blurred.delete(); equalized.delete();
        return outBuffer;
    } catch (error) {
        logger.error(`Error during chunk preprocessing: ${error}`);
        return chunk; // Fallback to original chunk on any error
    }
}

// --- RESTORED CRITICAL FUNCTION ---
/**
 * Gets the dimensions of an image file.
 * @param imagePath Path to the image file.
 * @returns A promise resolving to [width, height] or null.
 */
export async function getImageDimensions(imagePath: string): Promise<[number, number] | null> {
    try {
        const metadata = await sharp(imagePath).metadata();
        if (metadata.width && metadata.height) {
            return [metadata.width, metadata.height];
        }
        return null;
    } catch (error) {
        logger.error(`Error getting image dimensions: ${error}`);
        return null;
    }
}

// --- ALL OTHER FUNCTIONS REMAIN, AS THEY ARE CORRECT ---

export async function detectContentBlocks(
    imageBuffer: Buffer,
    metadata: sharp.Metadata,
    debug = false
): Promise<{ x: number, y: number, width: number, height: number }[]> {
    if (!ENABLE_OPENCV) return [];
    try {
        const cv = await loadOpenCV();
        const mat = new cv.Mat(metadata.height, metadata.width, cv.CV_8UC4);
        mat.data.set(imageBuffer);
        const gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY, 0);
        const thresh = new cv.Mat();
        cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

        if (debug && OPENCV_DEBUG_EXPORT) {
            const maskBuffer = await sharp(Buffer.from(thresh.data), { raw: { width: thresh.cols, height: thresh.rows, channels: 1 } }).png().toBuffer();
            await fs.writeFile('debug_thresh_mask.png', maskBuffer);
            logger.info('✅ Saved debug vision mask to debug_thresh_mask.png');
        }

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const contentBlocks: { x: number, y: number, width: number, height: number }[] = [];
        for (let i = 0; i < contours.size(); ++i) {
            const contour = contours.get(i);
            const rect = cv.boundingRect(contour);
            if (rect.width > OPENCV_MIN_BLOCK_W && rect.height > OPENCV_MIN_BLOCK_H && rect.width < metadata.width * OPENCV_MAX_WIDTH_FRAC) {
                contentBlocks.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }
            contour.delete();
        }

        mat.delete(); gray.delete(); thresh.delete(); contours.delete(); hierarchy.delete();
        return contentBlocks.sort((a, b) => a.y - b.y);
    } catch (error) {
        logger.error(`Error in detectContentBlocks: ${error}`);
        return [];
    }
}

export function calculateOptimalChunks(
    imageWidth: number, imageHeight: number, maxDim: number = DEFAULT_CHUNK_MAX_DIM, overlapPercent: number = DEFAULT_CHUNK_OVERLAP
): Array<[number, number, number, number]> {
    const chunkWidth = Math.min(maxDim, imageWidth);
    const chunkHeight = Math.min(maxDim, imageHeight);
    const stepX = Math.floor(chunkWidth * (1 - overlapPercent));
    const stepY = Math.floor(chunkHeight * (1 - overlapPercent));
    const chunks: Array<[number, number, number, number]> = [];
    for (let y = 0; y < imageHeight; y += stepY) {
        for (let x = 0; x < imageWidth; x += stepX) {
            const extractWidth = Math.min(chunkWidth, imageWidth - x);
            const extractHeight = Math.min(chunkHeight, imageHeight - y);
            if (extractWidth > 0 && extractHeight > 0) chunks.push([x, y, extractWidth, extractHeight]);
        }
    }
    const uniqueKeys = new Set<string>();
    return chunks.filter(c => {
        const key = c.join(',');
        if (uniqueKeys.has(key)) return false;
        uniqueKeys.add(key);
        return true;
    });
}

export function mergeBlocks(blocks: { x: number, y: number, width: number, height: number }[]): { x: number, y: number, width: number, height: number }[] {
    if (DISABLE_BLOCK_MERGE || blocks.length <= 1) return blocks;
    const sorted = blocks.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const merged: { x: number, y: number, width: number, height: number }[] = [];
    for (const rect of sorted) {
        let mergedIn = false;
        for (let i = 0; i < merged.length; i++) {
            const m = merged[i];
            const dx = Math.max(0, Math.max(m.x, rect.x) - Math.min(m.x + m.width, rect.x + rect.width));
            const dy = Math.max(0, Math.max(m.y, rect.y) - Math.min(m.y + m.height, rect.y + rect.height));
            if (dx <= 15 && dy <= 15) {
                const nx = Math.min(m.x, rect.x);
                const ny = Math.min(m.y, rect.y);
                const nx2 = Math.max(m.x + m.width, rect.x + rect.width);
                const ny2 = Math.max(m.y + m.height, rect.y + rect.height);
                merged[i] = { x: nx, y: ny, width: nx2 - nx, height: ny2 - ny };
                mergedIn = true;
                break;
            }
        }
        if (!mergedIn) merged.push({ ...rect });
    }
    return merged;
}

export async function chunkImage(
    imagePath: string, maxDim: number = DEFAULT_CHUNK_MAX_DIM, overlapPercent: number = DEFAULT_CHUNK_OVERLAP, debugMode: boolean = false
): Promise<ImageChunk[]> {
    logger.info(`Chunking image with content-aware strategy: ${imagePath}`);
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const rawImageBuffer = await image.ensureAlpha().raw().toBuffer();
    if (!metadata.width || !metadata.height) throw new Error('Could not determine image dimensions');

    const contentBlocks = await detectContentBlocks(rawImageBuffer, metadata, debugMode);
    if (contentBlocks.length === 0) {
        logger.warn("No content blocks detected. Falling back to simple grid chunking.");
        const chunkCoords = calculateOptimalChunks(metadata.width, metadata.height, maxDim, overlapPercent);
        const result: ImageChunk[] = [];
        for (const [i, [cx, cy, cw, ch]] of chunkCoords.entries()) {
            try {
                const chunkBuffer = await sharp(rawImageBuffer, { raw: { width: metadata.width, height: metadata.height, channels: 4 } })
                    .extract({ left: cx, top: cy, width: cw, height: ch }).png().toBuffer();
                result.push({ data: chunkBuffer, index: i, position: { x: cx, y: cy, width: cw, height: ch } });
            } catch (error) { logger.error(`Error extracting grid chunk at (${cx}, ${cy}): ${error}`); }
        }
        return result;
    }

    const mergedBlocks = mergeBlocks(contentBlocks);
    const result: ImageChunk[] = [];
    let chunkIndex = 0;
    for (const block of mergedBlocks) {
        const blockChunks = calculateOptimalChunks(block.width, block.height, maxDim, overlapPercent);
        for (const [cx, cy, cw, ch] of blockChunks) {
            const absoluteX = block.x + cx;
            const absoluteY = block.y + cy;
            try {
                const chunkBuffer = await sharp(rawImageBuffer, { raw: { width: metadata.width, height: metadata.height, channels: 4 } })
                    .extract({ left: absoluteX, top: absoluteY, width: cw, height: ch }).png().toBuffer();
                result.push({ data: chunkBuffer, index: chunkIndex++, position: { x: absoluteX, y: absoluteY, width: cw, height: ch } });
            } catch (error) { logger.error(`Error extracting sub-chunk at (${absoluteX}, ${absoluteY}): ${error}`); }
        }
    }
    logger.info(`Successfully created ${result.length} content-aware chunks.`);
    return result;
}

export async function getImageFormat(imagePath: string): Promise<SupportedImageFormat | null> {
    try {
        const metadata = await sharp(imagePath).metadata();
        return metadata.format as SupportedImageFormat || null;
    } catch (error) {
        logger.error(`Error getting image format: ${error}`);
        return null;
    }
}

export async function validateImage(imagePath: string): Promise<boolean> {
    try {
        await fs.access(imagePath);
        const stats = await fs.stat(imagePath);
        if (stats.isDirectory()) return false;
        if (stats.size > MAX_IMAGE_SIZE) return false;
        const format = await getImageFormat(imagePath);
        if (!format || !SUPPORTED_FORMATS.includes(format)) return false;
        return true;
    } catch (error) {
        logger.error(`Error validating image: ${error}`);
        return false;
    }
}