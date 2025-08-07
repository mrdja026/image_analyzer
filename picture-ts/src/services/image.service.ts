/**
 * Image service for validation and chunking
 * Ports functionality from image_validator.py, image_chunker.py, and image_utils.py
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
// OpenCV removed - using only grid-based chunking
import logger from '../lib/logger';
import { ImageChunk, SupportedImageFormat } from '../types';
import {
    MAX_IMAGE_SIZE,
    SUPPORTED_FORMATS,
    DEFAULT_CHUNK_MAX_DIM,
    DEFAULT_CHUNK_OVERLAP
} from '../config';

// OpenCV-based content block detection removed
// We now only use grid-based chunking for all images

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
): Promise<ImageChunk[]> {
    logger.info(`Chunking image with grid-based strategy: ${imagePath}`);

    // Load the image and get metadata
    const image = sharp(imagePath);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
        throw new Error('Could not determine image dimensions');
    }

    // Calculate grid-based chunks
    const gridCoords = calculateOptimalChunks(
        metadata.width,
        metadata.height,
        maxDim,
        overlapPercent
    );

    // Create chunks from the grid coordinates
    const chunks: ImageChunk[] = [];
    let chunkIndex = 0;

    for (const [x, y, w, h] of gridCoords) {
        try {
            const chunkBuffer = await image.clone().extract({
                left: x,
                top: y,
                width: w,
                height: h
            }).toBuffer();

            chunks.push({
                data: chunkBuffer,
                index: chunkIndex++,
                position: { x, y, width: w, height: h }
            });
        } catch (error) {
            logger.error(`Error extracting grid chunk at (${x}, ${y}): ${error}`);
        }
    }

    logger.info(`Created ${chunks.length} grid-based chunks`);
    return chunks;
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