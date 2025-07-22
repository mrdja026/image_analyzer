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
 * Calculate optimal chunk coordinates for splitting an image
 * @param imageWidth Width of the original image
 * @param imageHeight Height of the original image
 * @param maxDim Maximum dimension for a chunk
 * @param overlapPercent Percentage of overlap between chunks
 * @returns Array of chunk coordinates [x, y, width, height]
 */
export function calculateOptimalChunks(
    imageWidth: number,
    imageHeight: number,
    maxDim: number = DEFAULT_CHUNK_MAX_DIM,
    overlapPercent: number = DEFAULT_CHUNK_OVERLAP
): Array<[number, number, number, number]> {
    // Validate inputs
    if (imageWidth <= 0 || imageHeight <= 0) {
        logger.error(`Invalid image dimensions: ${imageWidth}x${imageHeight}`);
        return [];
    }

    if (maxDim <= 0) {
        logger.error(`Invalid max dimension: ${maxDim}`);
        return [];
    }

    if (overlapPercent < 0 || overlapPercent >= 1) {
        logger.error(`Invalid overlap percentage: ${overlapPercent}`);
        overlapPercent = DEFAULT_CHUNK_OVERLAP;
    }

    // Calculate dynamic aspect ratio based on image width
    let targetAspectRatio: number;

    if (imageWidth > 2000) {
        targetAspectRatio = 1.6;  // Wide format, good for text
    } else if (imageWidth > 1200) {
        targetAspectRatio = 1.4;  // Medium-wide format
    } else {
        targetAspectRatio = 1.2;  // Closer to square for smaller images
    }

    // Calculate chunk dimensions based on aspect ratio
    let chunkWidth: number;
    let chunkHeight: number;

    if (targetAspectRatio > 1) {
        // Width > height
        chunkWidth = Math.min(maxDim, imageWidth);
        chunkHeight = Math.floor(chunkWidth / targetAspectRatio);
    } else {
        // Height >= width
        chunkHeight = Math.min(maxDim, imageHeight);
        chunkWidth = Math.floor(chunkHeight * targetAspectRatio);
    }

    // Ensure chunk size doesn't exceed image dimensions
    chunkWidth = Math.min(chunkWidth, imageWidth);
    chunkHeight = Math.min(chunkHeight, imageHeight);

    // Ensure chunk dimensions are at least 1 pixel
    chunkWidth = Math.max(1, chunkWidth);
    chunkHeight = Math.max(1, chunkHeight);

    // Calculate step size with overlap
    const stepX = Math.max(1, Math.floor(chunkWidth * (1 - overlapPercent)));
    const stepY = Math.max(1, Math.floor(chunkHeight * (1 - overlapPercent)));

    // Calculate number of chunks in each dimension
    // Use max to ensure we have at least 1 chunk in each dimension
    const numXChunks = Math.max(1, Math.ceil((imageWidth - chunkWidth) / stepX) + 1);
    const numYChunks = Math.max(1, Math.ceil((imageHeight - chunkHeight) / stepY) + 1);

    logger.debug(`Calculated ${numXChunks}x${numYChunks} chunks of size ${chunkWidth}x${chunkHeight} with step ${stepX}x${stepY}`);

    const chunks: Array<[number, number, number, number]> = [];
    const seenChunks = new Set<string>();

    // Generate chunk coordinates - following the Python implementation more closely
    for (let y = 0; y < numYChunks; y++) {
        // Pre-calculate top position for end-of-loop check
        const topY = Math.min(y * stepY, imageHeight - chunkHeight);

        for (let x = 0; x < numXChunks; x++) {
            // Calculate top-left coordinates
            const left = Math.min(x * stepX, imageWidth - chunkWidth);
            const top = Math.min(y * stepY, imageHeight - chunkHeight);

            // Calculate bottom-right coordinates
            const right = left + chunkWidth;
            const bottom = top + chunkHeight;

            // Skip duplicate chunks using a string key
            const chunkKey = `${left},${top},${right},${bottom}`;
            if (!seenChunks.has(chunkKey)) {
                seenChunks.add(chunkKey);
                chunks.push([left, top, chunkWidth, chunkHeight]);
            }

            // If we've reached the edge of the image, break
            if (left + chunkWidth >= imageWidth) {
                break;
            }
        }

        // If we've reached the bottom of the image, break
        if (topY + chunkHeight >= imageHeight) {
            break;
        }
    }

    logger.info(`Generated ${chunks.length} unique chunks`);
    return chunks;
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