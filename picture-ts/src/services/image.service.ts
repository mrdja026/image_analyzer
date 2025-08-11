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

import { ENABLE_OPENCV, DETECT_SCALE, MAX_TOTAL_CHUNKS, BLOCK_SINGLETON_DIM_FACTOR, INBLOCK_OVERLAP, COARSE_GRID_MAX_DIM, COARSE_GRID_OVERLAP, MIN_INK_FRACTION, BLOCK_INK_MULTIPLIER, MAX_CHUNKS_PER_BLOCK, OPENCV_EDGE_INSET, OPENCV_KERNEL_BASE_W, OPENCV_KERNEL_BASE_H, OPENCV_KERNEL_MIN_W, OPENCV_KERNEL_MAX_W, OPENCV_MIN_BLOCK_W, OPENCV_MIN_BLOCK_H, OPENCV_MAX_WIDTH_FRAC, OPENCV_MAX_HEIGHT_FRAC, OPENCV_TALL_ASPECT_RATIO, OPENCV_TALL_DOWNSCALE, OPENCV_DEBUG_EXPORT, DISABLE_BLOCK_MERGE, PROJECTION_SPLIT_MIN_GAP, ENABLE_CHUNK_PREPROCESS, ENABLE_DUAL_PASS_OCR } from '../config';
import { getOpenCV } from '../lib/opencv';

async function loadOpenCV(): Promise<any> { return getOpenCV(); }

// Merge overlapping or adjacent content blocks to reduce fragmentation
export function mergeBlocks(blocks: { x: number, y: number, width: number, height: number }[]): { x: number, y: number, width: number, height: number }[] {
    if (DISABLE_BLOCK_MERGE || blocks.length <= 1) return blocks;
    // Sort by top-left
    const sorted = blocks.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const merged: { x: number, y: number, width: number, height: number }[] = [];

    const iou = (a: any, b: any) => {
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        const x2 = Math.min(a.x + a.width, b.x + b.width);
        const y2 = Math.min(a.y + a.height, b.y + b.height);
        const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const union = a.width * a.height + b.width * b.height - inter;
        return union > 0 ? inter / union : 0;
    };

    const shouldMerge = (a: any, b: any) => {
        // Merge if significantly overlapping or very close
        if (iou(a, b) >= 0.2) return true;
        const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
        const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
        return dx <= 10 && dy <= 10; // adjacency threshold
    };

    for (const rect of sorted) {
        let mergedIn = false;
        for (let i = 0; i < merged.length; i++) {
            const m = merged[i];
            if (shouldMerge(m, rect)) {
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

export async function detectContentBlocks(
    imageBuffer: Buffer,
    metadata: sharp.Metadata
): Promise<{ x: number, y: number, width: number, height: number }[]> {
    // Per reason.md, OpenCV.js is disabled by default. Only use if enabled.
    if (!ENABLE_OPENCV) {
        return [];
    }

    try {
        const cv = await loadOpenCV();

        const origWidth = metadata.width as number;
        const origHeight = metadata.height as number;
        if (!origWidth || !origHeight) return [];

        // Determine processing scale for very tall images
        const aspectRatio = origHeight / Math.max(1, origWidth);
        const scale = aspectRatio >= OPENCV_TALL_ASPECT_RATIO ? OPENCV_TALL_DOWNSCALE : (DETECT_SCALE > 0 ? DETECT_SCALE : 1.0);

        // Source RGBA Mat
        const srcRGBA = new cv.Mat(origHeight, origWidth, cv.CV_8UC4);
        srcRGBA.data.set(imageBuffer);

        // Resize for processing if needed
        let proc = srcRGBA;
        if (scale !== 1.0) {
            const resized = new cv.Mat();
            const newSize = new cv.Size(
                Math.max(1, Math.round(origWidth * scale)),
                Math.max(1, Math.round(origHeight * scale))
            );
            cv.resize(srcRGBA, resized, newSize, 0, 0, scale < 1.0 ? cv.INTER_AREA : cv.INTER_LINEAR);
            proc = resized;
        }

        // Add a small border to mitigate right/east edge artifacts
        const inset = OPENCV_EDGE_INSET;
        const bordered = new cv.Mat();
        const white = new cv.Scalar(255, 255, 255, 255);
        cv.copyMakeBorder(proc, bordered, inset, inset, inset, inset, cv.BORDER_CONSTANT, white);

        // Grayscale and Otsu inverted binary
        const gray = new cv.Mat();
        cv.cvtColor(bordered, gray, cv.COLOR_RGBA2GRAY, 0);
        const blurred = new cv.Mat();
        const blurK = new cv.Size(3, 3);
        cv.GaussianBlur(gray, blurred, blurK, 0, 0, cv.BORDER_DEFAULT);
        const bin = new cv.Mat();
        cv.threshold(blurred, bin, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

        // Morphological closing with wide-short kernel derived from width
        // Kernel from processed width directly
        const kernelW = Math.max(OPENCV_KERNEL_MIN_W, Math.min(OPENCV_KERNEL_MAX_W, Math.floor(proc.cols / 40)));
        const kernelH = OPENCV_KERNEL_BASE_H;
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelW, kernelH));
        const morph = new cv.Mat();
        cv.morphologyEx(bin, morph, cv.MORPH_CLOSE, kernel);

        // Contours and filtering
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const inv = 1 / scale;
        const blocks: { x: number, y: number, width: number, height: number }[] = [];
        for (let i = 0; i < contours.size(); ++i) {
            const rect = cv.boundingRect(contours.get(i));
            // Map back to original coordinates and remove padding
            const x = Math.max(0, Math.round((rect.x - inset) * inv));
            const y = Math.max(0, Math.round((rect.y - inset) * inv));
            const w = Math.round(rect.width * inv);
            const h = Math.round(rect.height * inv);

            // Clamp to image bounds
            const cx = Math.min(Math.max(0, x), origWidth - 1);
            const cy = Math.min(Math.max(0, y), origHeight - 1);
            const cw = Math.max(0, Math.min(w, origWidth - cx));
            const ch = Math.max(0, Math.min(h, origHeight - cy));

            if (cw < OPENCV_MIN_BLOCK_W || ch < OPENCV_MIN_BLOCK_H) continue; // tiny noise
            if (cw >= Math.floor(origWidth * OPENCV_MAX_WIDTH_FRAC) && ch >= Math.floor(origHeight * OPENCV_MAX_HEIGHT_FRAC)) continue; // page-sized
            blocks.push({ x: cx, y: cy, width: cw, height: ch });
        }

        // Cleanup mats
        contours.delete(); hierarchy.delete(); morph.delete(); kernel.delete?.(); bin.delete(); blurred.delete(); gray.delete(); bordered.delete();
        if (proc !== srcRGBA) proc.delete();
        srcRGBA.delete();

        logger.info(`OpenCV detection: blocks=${blocks.length} kernel=${kernelW}x${kernelH} scale=${scale.toFixed(2)} aspect=${aspectRatio.toFixed(2)}`);
        return blocks.sort((a, b) => a.y - b.y);
    } catch (error) {
        return [];
    }
}

/**
 * Preprocess an image chunk for OCR using OpenCV (grayscale + denoise + Otsu threshold).
 * Falls back to the original chunk on any failure or when OpenCV is disabled.
 */
export async function preprocessChunkForOcr(chunk: Buffer): Promise<Buffer> {
    try {
        if (!ENABLE_OPENCV || !ENABLE_CHUNK_PREPROCESS) {
            return chunk;
        }

        const cv = await loadOpenCV();

        // Decode with sharp to get raw pixels
        const img = sharp(chunk);
        const metadata = await img.metadata();
        if (!metadata.width || !metadata.height) {
            return chunk;
        }

        const width = metadata.width as number;
        const height = metadata.height as number;
        const raw = await img.ensureAlpha().raw().toBuffer();

        // Create RGBA Mat
        const src = new cv.Mat(height, width, cv.CV_8UC4);
        src.data.set(raw);

        // Add a small white border to avoid edge artifacts (e.g., right/east edge issues)
        const borderSize = 2;
        const bordered = new cv.Mat();
        const white = new cv.Scalar(255, 255, 255, 255);
        cv.copyMakeBorder(
            src,
            bordered,
            borderSize,
            borderSize,
            borderSize,
            borderSize,
            cv.BORDER_CONSTANT,
            white
        );

        // Convert to grayscale
        const gray = new cv.Mat();
        cv.cvtColor(bordered, gray, cv.COLOR_RGBA2GRAY, 0);

        // Light blur to reduce noise
        const blurred = new cv.Mat();
        const ksize = new cv.Size(3, 3);
        cv.GaussianBlur(gray, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

        // Mild contrast stretch without hard binarization for VLMs
        const bin = new cv.Mat();
        cv.equalizeHist(blurred, bin);

        // Convert back to PNG buffer (1 channel → PNG grayscale)
        const outWidth = bordered.cols;
        const outHeight = bordered.rows;
        const out = await sharp(Buffer.from(bin.data), {
            raw: { width: outWidth, height: outHeight, channels: 1 }
        })
            .png()
            .toBuffer();

        // Cleanup
        bin.delete();
        blurred.delete();
        gray.delete();
        bordered.delete();
        src.delete();

        return out;
    } catch {
        return chunk;
    }
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
    // If OpenCV is disabled, we rely on grid-based chunking per reason.md.
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
    if (contentBlocks.length > 0) {
        logger.info(`Detected ${contentBlocks.length} potential content blocks.`);
    } else {
        logger.warn('No content blocks detected or OpenCV disabled; falling back to grid-based chunking.');
    }

    // --- STEP 3: FALLBACK and CHUNKING LOGIC ---
    // If our smart detector finds nothing, we fall back to the old, simple grid.
    if (contentBlocks.length === 0) {
        const chunkCoords = calculateOptimalChunks(
            metadata.width as number,
            metadata.height as number,
            maxDim,
            overlapPercent
        );
        const result: ImageChunk[] = [];
        let chunkIndex = 0;
        for (const [cx, cy, cw, ch] of chunkCoords) {
            try {
                const chunkBuffer = await image.clone().extract({
                    left: cx,
                    top: cy,
                    width: cw,
                    height: ch
                }).toBuffer();

                result.push({
                    data: chunkBuffer,
                    index: chunkIndex++,
                    position: { x: cx, y: cy, width: cw, height: ch }
                });
            } catch (error) {
                logger.error(`Error extracting grid chunk at (${cx}, ${cy}): ${error}`);
            }
        }
        logger.info(`Generated ${result.length} grid chunks.`);
        return result;
    }

    // Merge overlapping/adjacent blocks to reduce fragmentation
    const mergedBlocks = mergeBlocks(contentBlocks);

    const result: ImageChunk[] = [];
    let chunkIndex = 0;

    // --- STEP 4: INTELLIGENT CHUNKING WITH BUDGET ---
    // 1) Treat small blocks as single chunks (no subdivision)
    // 2) Use smaller overlap within blocks
    // 3) Enforce a total chunk budget; adapt with coarser inner chunking
    let estimatedTotal = 0;
    const singletonThresholdW = Math.floor(maxDim * BLOCK_SINGLETON_DIM_FACTOR);
    const singletonThresholdH = Math.floor(maxDim * BLOCK_SINGLETON_DIM_FACTOR);

    // Estimate initial total
    for (const b of mergedBlocks) {
        const innerMaxDimW = Math.min(maxDim, b.width);
        const innerMaxDimH = Math.min(maxDim, b.height);
        const stepX = Math.floor(innerMaxDimW * (1 - INBLOCK_OVERLAP));
        const stepY = Math.floor(innerMaxDimH * (1 - INBLOCK_OVERLAP));
        const nx = Math.max(1, Math.ceil((b.width - innerMaxDimW) / stepX + 1));
        const ny = Math.max(1, Math.ceil((b.height - innerMaxDimH) / stepY + 1));
        estimatedTotal += Math.max(1, nx * ny);
    }

    // If estimate too high, adapt strategy
    let innerOverlap = INBLOCK_OVERLAP;
    let innerMaxDim = maxDim;
    if (estimatedTotal > MAX_TOTAL_CHUNKS) {
        // First try: reduce overlap and increase inner chunk size moderately
        innerOverlap = Math.max(0.08, INBLOCK_OVERLAP - 0.04);
        innerMaxDim = Math.min(Math.floor(maxDim * 1.25), Math.max(900, maxDim));
    }

    // Recalculate estimate after adaptation
    let adaptedEstimate = 0;
    for (const b of mergedBlocks) {
        const innerMaxDimW = Math.min(innerMaxDim, b.width);
        const innerMaxDimH = Math.min(innerMaxDim, b.height);
        const stepX = Math.floor(innerMaxDimW * (1 - innerOverlap));
        const stepY = Math.floor(innerMaxDimH * (1 - innerOverlap));
        const nx = Math.max(1, Math.ceil((b.width - innerMaxDimW) / stepX + 1));
        const ny = Math.max(1, Math.ceil((b.height - innerMaxDimH) / stepY + 1));
        adaptedEstimate += Math.max(1, nx * ny);
    }

    // If still too high, fall back to coarse grid globally
    if (adaptedEstimate > MAX_TOTAL_CHUNKS * 1.2) {
        const coarseCoords = calculateOptimalChunks(
            metadata.width as number,
            metadata.height as number,
            COARSE_GRID_MAX_DIM,
            COARSE_GRID_OVERLAP
        );
        const coarse: ImageChunk[] = [];
        for (const [cx, cy, cw, ch] of coarseCoords) {
            try {
                const chunkBuffer = await image.clone().extract({ left: cx, top: cy, width: cw, height: ch }).toBuffer();
                coarse.push({ data: chunkBuffer, index: chunkIndex++, position: { x: cx, y: cy, width: cw, height: ch } });
            } catch (e) {
                logger.error(`Error extracting coarse grid chunk at (${cx}, ${cy}): ${e}`);
            }
        }
        logger.info(`Applied coarse grid due to budget. Generated ${coarse.length} grid chunks.`);
        return coarse;
    }

    // Proceed with block-aware extraction
    for (const block of mergedBlocks) {
        // Skip blocks with very low text density
        const blockInk = await estimateInkFraction(image, block.x, block.y, block.width, block.height);
        if (blockInk < MIN_INK_FRACTION * BLOCK_INK_MULTIPLIER) {
            logger.debug?.(`Skipping low-ink block at (${block.x}, ${block.y}) ink=${blockInk.toFixed(3)}`);
            continue;
        }

        const isSingleton = block.width <= singletonThresholdW && block.height <= singletonThresholdH;
        if (isSingleton) {
            try {
                const chunkBuffer = await image.clone().extract({ left: block.x, top: block.y, width: block.width, height: block.height }).toBuffer();
                result.push({ data: chunkBuffer, index: chunkIndex++, position: { x: block.x, y: block.y, width: block.width, height: block.height } });
            } catch (e) {
                logger.error(`Error extracting singleton block at (${block.x}, ${block.y}): ${e}`);
            }
            continue;
        }

        const blockChunks = calculateOptimalChunks(block.width, block.height, innerMaxDim, innerOverlap);
        // Rank chunks by ink density and cap per-block
        const ranked: Array<{ score: number, cx: number, cy: number, cw: number, ch: number }> = [];
        for (const [cx, cy, cw, ch] of blockChunks) {
            const absX = block.x + cx, absY = block.y + cy;
            const score = await estimateInkFraction(image, absX, absY, cw, ch);
            if (score >= MIN_INK_FRACTION) {
                ranked.push({ score, cx, cy, cw, ch });
            }
        }

        ranked.sort((a, b) => b.score - a.score);
        const limited = MAX_CHUNKS_PER_BLOCK > 0 ? ranked.slice(0, MAX_CHUNKS_PER_BLOCK) : ranked;

        for (const { cx, cy, cw, ch } of limited) {
            const absoluteX = block.x + cx;
            const absoluteY = block.y + cy;
            try {
                const chunkBuffer = await image.clone().extract({ left: absoluteX, top: absoluteY, width: cw, height: ch }).toBuffer();
                result.push({ data: chunkBuffer, index: chunkIndex++, position: { x: absoluteX, y: absoluteY, width: cw, height: ch } });
            } catch (error) {
                logger.error(`Error extracting sub-chunk at (${absoluteX}, ${absoluteY}): ${error}`);
            }
        }
    }

    logger.info(`Successfully created ${result.length} content-aware chunks.`);
    return result;
}

// Estimate "ink" (text density) by downscaling to a tiny grayscale and counting dark pixels
async function estimateInkFraction(
    image: sharp.Sharp,
    left: number,
    top: number,
    width: number,
    height: number
): Promise<number> {
    try {
        const targetSize = 48; // tiny proxy
        const buf = await image
            .clone()
            .extract({ left, top, width, height })
            .grayscale()
            .resize({ width: Math.min(targetSize, Math.max(1, width)), height: Math.min(targetSize, Math.max(1, height)), fit: 'fill' })
            .raw()
            .toBuffer();
        let dark = 0;
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] < 180) dark++; // threshold for "ink"
        }
        return dark / buf.length;
    } catch {
        return 1.0; // be permissive on failure
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