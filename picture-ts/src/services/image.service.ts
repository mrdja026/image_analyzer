/**
 * Image service for validation and chunking
 * Ports functionality from image_validator.py, image_chunker.py, and image_utils.py
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import logger from '../lib/logger';
import { ImageChunk, SupportedImageFormat } from '../types';
import {
    MAX_IMAGE_SIZE,
    SUPPORTED_FORMATS,
    DEFAULT_CHUNK_MAX_DIM,
    DEFAULT_CHUNK_OVERLAP
} from '../config';

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
 * Check if an image is blank (i.e., a single solid color) or nearly blank
 * @param imageBuffer The image buffer to check
 * @param threshold The maximum difference in pixel values to be considered blank
 * @returns Promise resolving to true if the image is blank, false otherwise
 */
export async function isImageBlank(imageBuffer: Buffer, threshold: number = 10): Promise<boolean> {
    try {
        // Convert to grayscale for simpler analysis
        const { data, info } = await sharp(imageBuffer)
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        if (!data || data.length === 0) {
            return true; // Empty image
        }

        // Calculate histogram (simple version)
        const histogram = new Array(256).fill(0);
        for (let i = 0; i < data.length; i++) {
            histogram[data[i]]++;
        }

        // Find the most common pixel value and its count
        const maxCount = Math.max(...histogram);
        const totalPixels = info.width * info.height;

        // If one color dominates more than 95% of the image, consider it blank
        if (maxCount / totalPixels > 0.95) {
            return true;
        }

        // Get min and max values
        let min = 255;
        let max = 0;

        for (let i = 0; i < histogram.length; i++) {
            if (histogram[i] > 0) {
                min = Math.min(min, i);
                max = Math.max(max, i);
            }
        }

        // If the difference between min and max is less than threshold, consider it blank
        return (max - min) <= threshold;
    } catch (error) {
        logger.error(`Error checking if image is blank: ${error}`);
        return false; // Assume not blank to avoid skipping potentially valid content
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
    overlapPercent: number = DEFAULT_CHUNK_OVERLAP,
    saveChunks: boolean = false,
    outputDir?: string,
    forceChunk: boolean = false
): Promise<ImageChunk[]> {
    logger.info(`Chunking image: ${imagePath}`);

    try {
        // Get image metadata
        const image = sharp(imagePath);
        const metadata = await image.metadata();

        if (!metadata.width || !metadata.height) {
            throw new Error('Could not determine image dimensions');
        }

        const { width, height } = metadata;
        logger.info(`Original image dimensions: ${width}x${height}`);

        // If the image is already reasonably sized with good aspect ratio and force chunking is not enabled, no chunking needed
        if (!forceChunk && width <= maxDim && height <= maxDim && 0.75 <= width / height && width / height <= 1.5) {
            logger.info("Image doesn't need chunking - good size and aspect ratio");
            const buffer = await image.toBuffer();
            return [{
                data: buffer,
                index: 0,
                position: {
                    x: 0,
                    y: 0,
                    width,
                    height
                }
            }];
        }

        // Calculate chunk coordinates
        const chunkCoords = calculateOptimalChunks(width, height, maxDim, overlapPercent);
        logger.info(`Splitting image into ${chunkCoords.length} chunks`);

        // Create output directory if saving chunks
        if (saveChunks && outputDir) {
            await fs.mkdir(outputDir, { recursive: true });
        }

        // Process each chunk
        const result: ImageChunk[] = [];

        for (let i = 0; i < chunkCoords.length; i++) {
            try {
                const [x, y, chunkWidth, chunkHeight] = chunkCoords[i];

                // Validate chunk coordinates to ensure they're within image bounds
                if (x < 0 || y < 0 || chunkWidth <= 0 || chunkHeight <= 0 ||
                    x + chunkWidth > width || y + chunkHeight > height) {
                    logger.warn(`Skipping invalid chunk coordinates: (${x}, ${y}, ${chunkWidth}, ${chunkHeight}) for image ${width}x${height}`);
                    continue;
                }

                logger.debug(`Extracting chunk ${i + 1}/${chunkCoords.length}: (${x}, ${y}, ${chunkWidth}, ${chunkHeight})`);

                // For very large images, try to use a more memory-efficient approach
                let chunkBuffer: Buffer;
                try {
                    // Extract the chunk
                    chunkBuffer = await image
                        .clone() // Create a new instance to avoid modifying the original
                        .extract({ left: x, top: y, width: chunkWidth, height: chunkHeight })
                        .toBuffer();
                } catch (extractError) {
                    logger.error(`Error extracting chunk at (${x}, ${y}, ${chunkWidth}, ${chunkHeight}): ${extractError}`);

                    // Try an alternative approach for large images
                    try {
                        logger.info(`Trying alternative extraction method for chunk ${i + 1}`);
                        chunkBuffer = await sharp(imagePath)
                            .extract({ left: x, top: y, width: chunkWidth, height: chunkHeight })
                            .toBuffer();
                    } catch (altError) {
                        logger.error(`Alternative extraction also failed: ${altError}`);
                        continue; // Skip this chunk
                    }
                }

                // Check if the chunk is blank
                if (await isImageBlank(chunkBuffer)) {
                    logger.info(`Skipping blank chunk at coordinates (${x}, ${y}, ${chunkWidth}, ${chunkHeight})`);
                    continue;
                }

                // Save the chunk if requested
                if (saveChunks && outputDir) {
                    const chunkPath = path.join(outputDir, `chunk_${i.toString().padStart(3, '0')}.png`);
                    await sharp(chunkBuffer).toFile(chunkPath);
                    logger.debug(`Saved chunk ${i} to ${chunkPath}`);
                }

                // Add the chunk to the result
                result.push({
                    data: chunkBuffer,
                    index: i,
                    position: {
                        x,
                        y,
                        width: chunkWidth,
                        height: chunkHeight
                    }
                });
            } catch (error) {
                logger.error(`Error processing chunk ${i + 1}: ${error}`);
                // Continue with next chunk instead of failing the whole process
            }
        }

        logger.info(`Successfully created ${result.length} chunks out of ${chunkCoords.length} calculated chunks`);

        if (result.length === 0) {
            throw new Error('No valid image chunks were generated');
        }

        return result;
    } catch (error) {
        logger.error(`Error chunking image: ${error}`);
        throw error;
    }
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