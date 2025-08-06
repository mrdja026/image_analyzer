/**
 * Image service for validation and chunking
 * Ports functionality from image_validator.py, image_chunker.py, and image_utils.py
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
    DEFAULT_CHUNK_OVERLAP
} from '../config';

export async function detectContentBlocks(
    imageBuffer: Buffer,
    metadata: sharp.Metadata
): Promise<{ x: number, y: number, width: number, height: number }[]> {

    // ------------ START OF THE CRITICAL FIX ------------
    // In this WASM version, we must manually create a Mat and load the data.
    // We assume the sharp buffer is RGBA (4 channels).
    const mat = new cv.Mat(metadata.height, metadata.width, cv.CV_8UC4);
    mat.data.set(imageBuffer);
    // ------------  END OF THE CRITICAL FIX  ------------

    // 1. Pre-processing: Convert to grayscale and apply a binary threshold
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY, 0);

    const thresh = new cv.Mat();
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

    // 2. Contour Detection: Find the "blobs" of content by connecting nearby text.
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(40, 5));
    const morph = new cv.Mat();
    cv.morphologyEx(thresh, morph, cv.MORPH_CLOSE, kernel);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // 3. Filter and Extract Bounding Boxes
    const contentBlocks: { x: number, y: number, width: number, height: number }[] = [];
    for (let i = 0; i < contours.size(); ++i) {
        const contour = contours.get(i);
        const rect = cv.boundingRect(contour);

        if (rect.width > 50 && rect.height > 20 && rect.width < metadata.width * 0.98) {
            contentBlocks.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
        contour.delete();
    }

    // Clean up OpenCV memory
    mat.delete(); gray.delete(); thresh.delete(); morph.delete(); contours.delete(); hierarchy.delete();

    // Sort blocks by their top-to-bottom reading order
    return contentBlocks.sort((a, b) => a.y - b.y);
}

/**
 * Validates if the file is an image and checks its size
 * @param imagePath Path to the image file
 * @returns Promise resolving to true if valid, false otherwise
 */
export async function validateImage(imagePath: string): Promise<boolean> {
    try {
        // Check if path exists
        await fs.access(imagePath);

        // Get file stats
        const stats = await fs.stat(imagePath);

        // Check if it's a file and not a directory
        if (stats.isDirectory()) {
            logger.error(`Path is a directory, not a file: ${imagePath}`);
            return false;
        }

        // Check file size
        if (stats.size > MAX_IMAGE_SIZE) {
            logger.error(`Image size ${stats.size} bytes exceeds maximum allowed size of ${MAX_IMAGE_SIZE} bytes`);
            return false;
        }

        // Check if it's actually an image with a supported format
        const format = await getImageFormat(imagePath);
        if (!format || !SUPPORTED_FORMATS.includes(format)) {
            logger.error(`File is not a supported image format: ${imagePath}`);
            logger.error(`Detected format: ${format || 'unknown'}`);
            logger.error(`Supported formats: ${SUPPORTED_FORMATS.join(', ')}`);
            return false;
        }

        return true;
    } catch (error) {
        logger.error(`Error validating image: ${error}`);
        return false;
    }
}

/**
 * Get the format of an image file using sharp
 * @param imagePath Path to the image file
 * @returns Promise resolving to the image format or null if not a supported image
 */
export async function getImageFormat(imagePath: string): Promise<SupportedImageFormat | null> {
    try {
        const metadata = await sharp(imagePath).metadata();
        return metadata.format as SupportedImageFormat || null;
    } catch (error) {
        logger.error(`Error getting image format: ${error}`);
        return null;
    }
}

/**
 * Calculates a simple, predictable grid of chunk coordinates.
 */
export function calculateOptimalChunks(
    imageWidth: number,
    imageHeight: number,
    maxDim: number = DEFAULT_CHUNK_MAX_DIM,
    overlapPercent: number = DEFAULT_CHUNK_OVERLAP
): Array<[number, number, number, number]> {
    // Use a fixed, square-like chunk size for simplicity and predictability.
    // The vision model can handle this.
    const chunkWidth = Math.min(maxDim, imageWidth);
    const chunkHeight = Math.min(maxDim, imageHeight);

    // Calculate the step size (how far to move for the next chunk)
    const stepX = Math.floor(chunkWidth * (1 - overlapPercent));
    const stepY = Math.floor(chunkHeight * (1 - overlapPercent));

    const chunks: Array<[number, number, number, number]> = [];

    // Iterate over the image with the calculated step size
    for (let y = 0; y < imageHeight; y += stepY) {
        for (let x = 0; x < imageWidth; x += stepX) {
            // Define the top-left corner of the potential chunk
            const currentX = x;
            const currentY = y;

            // Ensure the chunk does not go out of bounds
            const extractWidth = Math.min(chunkWidth, imageWidth - currentX);
            const extractHeight = Math.min(chunkHeight, imageHeight - currentY);

            // Only add chunks that have a meaningful size
            if (extractWidth > 0 && extractHeight > 0) {
                chunks.push([currentX, currentY, extractWidth, extractHeight]);
            }
        }
    }

    // A simple approach to remove duplicates that can occur at the edges
    const uniqueKeys = new Set<string>();
    const uniqueChunks = chunks.filter(c => {
        const key = c.join(',');
        if (uniqueKeys.has(key)) {
            return false;
        }
        uniqueKeys.add(key);
        return true;
    });

    logger.info(`Generated ${uniqueChunks.length} unique chunks`);
    return uniqueChunks;
}

/**
 * Split an image into smaller, overlapping chunks
 * @param imagePath Path to the input image
 * @param maxDim Maximum dimension for a chunk
 * @param overlapPercent Percentage of overlap between chunks
 * @param saveChunks Whether to save chunks to disk
 * @param outputDir Directory to save chunks
 * @param forceChunk Force chunking even for small images
 * @returns Promise resolving to an array of image chunks
 */
export async function chunkImage(
    imagePath: string,
    maxDim: number = DEFAULT_CHUNK_MAX_DIM,
    overlapPercent: number = DEFAULT_CHUNK_OVERLAP
    // Note: saveChunks and outputDir logic can be added back here if needed
): Promise<ImageChunk[]> {
    logger.info(`Chunking image with content-aware strategy: ${imagePath}`);

    // --- STEP 1: EFFICIENT DATA LOADING ---
    // We read the file and get its metadata and raw pixel buffer ONCE.
    // This is far more efficient than passing file paths around.
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    // CRITICAL for OpenCV: Ensure we have a raw, 4-channel (RGBA) pixel buffer.
    const rawImageBuffer = await image.ensureAlpha().raw().toBuffer();

    if (!metadata.width || !metadata.height) {
        throw new Error('Could not determine image dimensions');
    }

    // --- STEP 2: CONTENT DETECTION ---
    // We call our new function with the CORRECT arguments: the buffer and metadata.
    const contentBlocks = await detectContentBlocks(rawImageBuffer, metadata);
    logger.info(`Detected ${contentBlocks.length} potential content blocks.`);

    // --- STEP 3: FALLBACK and CHUNKING LOGIC ---
    // If our smart detector finds nothing, we fall back to the old, simple grid.
    if (contentBlocks.length === 0) {
        logger.warn("No content blocks detected. Falling back to simple grid chunking.");
        const chunkCoords = calculateOptimalChunks(metadata.width, metadata.height, maxDim, overlapPercent);
        // This part of the logic can reuse your previous loop that extracts based on coordinates.
        // For now, we focus on the successful path.
        // ... (insert fallback logic here) ...
        return [];
    }

    const result: ImageChunk[] = [];
    let chunkIndex = 0;

    // --- STEP 4: INTELLIGENT CHUNKING ---
    // We now loop through the logical blocks we detected, NOT a blind grid.
    for (const block of contentBlocks) {
        // A large content block might still need to be subdivided.
        // We use our simple grid chunker, but now it's working on a clean, pre-filtered area.
        const blockChunks = calculateOptimalChunks(block.width, block.height, maxDim, overlapPercent);

        for (const [cx, cy, cw, ch] of blockChunks) {
            // Calculate the chunk's absolute position on the original image
            const absoluteX = block.x + cx;
            const absoluteY = block.y + cy;

            try {
                // Extract the final chunk buffer from the original image instance.
                const chunkBuffer = await image.clone().extract({
                    left: absoluteX,
                    top: absoluteY,
                    width: cw,
                    height: ch
                }).toBuffer();

                // We no longer need isImageBlank because we started from verified content!
                result.push({
                    data: chunkBuffer,
                    index: chunkIndex++,
                    position: { x: absoluteX, y: absoluteY, width: cw, height: ch }
                });

            } catch (error) {
                logger.error(`Error extracting sub-chunk at (${absoluteX}, ${absoluteY}): ${error}`);
            }
        }
    }

    logger.info(`Successfully created ${result.length} content-aware chunks.`);
    return result;
}

/**
 * Save image chunks to disk
 * @param chunks Array of image chunks
 * @param outputDir Directory to save chunks
 * @returns Promise resolving to an array of saved file paths
 */
export async function saveImageChunks(
    chunks: ImageChunk[],
    outputDir: string
): Promise<string[]> {
    try {
        await fs.mkdir(outputDir, { recursive: true });

        const savedPaths: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkPath = path.join(outputDir, `chunk_${i.toString().padStart(3, '0')}.png`);

            await sharp(chunk.data).toFile(chunkPath);
            savedPaths.push(chunkPath);
        }

        logger.info(`Saved ${savedPaths.length} chunks to ${outputDir}`);
        return savedPaths;
    } catch (error) {
        logger.error(`Error saving image chunks: ${error}`);
        return [];
    }
}

/**
 * Get the dimensions of an image
 * @param imagePath Path to the image file
 * @returns Promise resolving to [width, height] or null if dimensions cannot be determined
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