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

import { ENABLE_OPENCV, DETECT_SCALE, MAX_TOTAL_CHUNKS, BLOCK_SINGLETON_DIM_FACTOR, INBLOCK_OVERLAP, COARSE_GRID_MAX_DIM, COARSE_GRID_OVERLAP, MIN_INK_FRACTION, BLOCK_INK_MULTIPLIER, MAX_CHUNKS_PER_BLOCK, PHOTO_VARIANCE_THRESHOLD } from '../config';
import { getOpenCV } from '../lib/opencv';

async function loadOpenCV(): Promise<any> { return getOpenCV(); }

// Merge overlapping or adjacent content blocks to reduce fragmentation
export function mergeBlocks(blocks: { x: number, y: number, width: number, height: number }[]): { x: number, y: number, width: number, height: number }[] {
    if (blocks.length <= 1) return blocks;
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

        // Helper to process at a given scale with different thresholding strategies
        const processAtScale = (scale: number) => {
            // Create source RGBA mat
            const matRGBA = new cv.Mat(origHeight, origWidth, cv.CV_8UC4);
            matRGBA.data.set(imageBuffer);
            try {
                const r = (matRGBA as any).rows ?? origHeight;
                const c = (matRGBA as any).cols ?? origWidth;
                const ch = typeof (matRGBA as any).channels === 'function' ? (matRGBA as any).channels() : 4;
                logger.info(`OpenCV processAtScale start: scale=${scale}, rows=${r}, cols=${c}, channels=${ch}`);
            } catch { }
            // Resize
            let mat: any = matRGBA;
            if (scale !== 1.0) {
                const resized = new cv.Mat();
                const newSize = new cv.Size(
                    Math.max(1, Math.round(origWidth * scale)),
                    Math.max(1, Math.round(origHeight * scale))
                );
                cv.resize(matRGBA, resized, newSize, 0, 0, scale < 1.0 ? cv.INTER_AREA : cv.INTER_LINEAR);
                mat = resized;
            }

            const gray = new cv.Mat();
            cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY, 0);

            // Light blur to reduce noise
            const blurred = new cv.Mat();
            const ksize = new cv.Size(3, 3);
            cv.GaussianBlur(gray, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

            const tryThresholds = [
                { type: 'otsu_inv', fn: () => { const m = new cv.Mat(); cv.threshold(blurred, m, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU); return m; } },
                { type: 'otsu', fn: () => { const m = new cv.Mat(); cv.threshold(blurred, m, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU); return m; } },
                { type: 'adaptive_mean', fn: () => { const m = new cv.Mat(); cv.adaptiveThreshold(blurred, m, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 35, 10); return m; } },
            ];

            const contentBlocksAll: { x: number, y: number, width: number, height: number }[] = [];
            let selectedKernel: [number, number] = [0, 0];
            let usedType = '';

            for (const t of tryThresholds) {
                const bin = t.fn();
                // Morphology: wider horizontal kernel, modest vertical to connect text lines into blocks
                const kx = Math.max(20, Math.floor(mat.cols / 40));
                const ky = Math.max(3, Math.floor(mat.rows / 300));
                const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kx, ky));
                const morph = new cv.Mat();
                cv.morphologyEx(bin, morph, cv.MORPH_CLOSE, kernel);

                const contours = new cv.MatVector();
                const hierarchy = new cv.Mat();
                cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                const blocks: { x: number, y: number, width: number, height: number }[] = [];
                const inv = 1 / scale;
                for (let i = 0; i < contours.size(); ++i) {
                    const rect = cv.boundingRect(contours.get(i));
                    const x = Math.round(rect.x * inv);
                    const y = Math.round(rect.y * inv);
                    const w = Math.round(rect.width * inv);
                    const h = Math.round(rect.height * inv);
                    // Relative min-size thresholds to avoid over-tight crops
                    const minW = Math.max(40, Math.floor((origWidth as number) * 0.03));
                    const minH = Math.max(20, Math.floor((origHeight as number) * 0.02));
                    if (w >= minW && h >= minH && w < origWidth * 0.99 && h < origHeight * 0.99) {
                        blocks.push({ x, y, width: w, height: h });
                    }
                }

                // Cleanup per iteration
                bin.delete(); morph.delete(); kernel.delete?.(); contours.delete(); hierarchy.delete();

                if (blocks.length > 0) {
                    contentBlocksAll.push(...blocks);
                    selectedKernel = [kx, ky];
                    usedType = t.type;
                    // Prefer first successful method
                    break;
                }
            }

            // Cleanup mats
            if (scale !== 1.0) mat.delete();
            gray.delete(); blurred.delete(); matRGBA.delete();
            const sample = contentBlocksAll.slice(0, 5).map(b => `${b.x},${b.y},${b.width}x${b.height}`).join(' | ');
            logger.info(`OpenCV blocks at scale=${scale}: count=${contentBlocksAll.length}, sample=[${sample}]`);
            return { blocks: contentBlocksAll, kernel: selectedKernel, type: usedType };
        };

        // Try multiple scales: configured, 1.0, and 1.5 upscale
        const scales = Array.from(new Set([
            (DETECT_SCALE > 0 ? DETECT_SCALE : 1.0),
            1.0,
            1.5,
        ])).filter(s => s > 0.2 && s <= 2.0);

        for (const s of scales) {
            const { blocks, kernel, type } = processAtScale(s);
            logger.info(`OpenCV detection at scale=${s} using ${type} produced ${blocks.length} blocks (kernel=${kernel[0]}x${kernel[1]}).`);
            if (blocks.length > 0) {
                return blocks.sort((a, b) => a.y - b.y);
            }
        }

        // No blocks found at any scale
        return [];
    } catch (error) {
        // Any OpenCV failure should force grid fallback.
        return [];
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
    // Prefer OpenCV content-aware chunking when enabled; avoid defaulting to grid.
    logger.info(`Chunking image (OpenCV-first strategy): ${imagePath}`);

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
        if (!ENABLE_OPENCV) {
            logger.warn('OpenCV disabled; using grid-based chunking.');
            const chunkCoords = calculateOptimalChunks(
                metadata.width as number,
                metadata.height as number,
                maxDim,
                overlapPercent
            );
            const gridChunks: ImageChunk[] = [];
            let gIndex = 0;
            for (const [cx, cy, cw, ch] of chunkCoords) {
                try {
                    const buf = await image.clone().extract({ left: cx, top: cy, width: cw, height: ch }).toBuffer();
                    gridChunks.push({ data: buf, index: gIndex++, position: { x: cx, y: cy, width: cw, height: ch } });
                } catch (e) {
                    logger.error(`Error extracting grid chunk at (${cx}, ${cy}): ${e}`);
                }
            }
            logger.info(`Generated ${gridChunks.length} grid chunks.`);
            return gridChunks;
        }
        // OpenCV enabled but detected zero blocks: use a single full-image chunk to preserve context
        logger.warn('OpenCV detected zero blocks; using a single full-image chunk.');
        const fullBuf = await image.clone().toBuffer();
        return [{ data: fullBuf, index: 0, position: { x: 0, y: 0, width: metadata.width as number, height: metadata.height as number } }];
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

    // Global candidate collection for text-first ranking
    type Candidate = { score: number, x: number, y: number, w: number, h: number };
    const candidates: Candidate[] = [];

    for (const block of mergedBlocks) {
        // Skip blocks with very low text density
        const blockInk = await estimateInkFraction(image, block.x, block.y, block.width, block.height);
        if (blockInk < MIN_INK_FRACTION * BLOCK_INK_MULTIPLIER) {
            logger.debug?.(`Skipping low-ink block at (${block.x}, ${block.y}) ink=${blockInk.toFixed(3)}`);
            continue;
        }

        const isSingleton = block.width <= singletonThresholdW && block.height <= singletonThresholdH;
        if (isSingleton) {
            candidates.push({ score: blockInk, x: block.x, y: block.y, w: block.width, h: block.height });
            continue;
        }

        const blockChunks = calculateOptimalChunks(block.width, block.height, innerMaxDim, innerOverlap);
        const ranked: Array<{ score: number, x: number, y: number, w: number, h: number }> = [];
        for (const [cx, cy, cw, ch] of blockChunks) {
            const absX = block.x + cx, absY = block.y + cy;
            const score = await estimateInkFraction(image, absX, absY, cw, ch);
            if (score >= MIN_INK_FRACTION) {
                ranked.push({ score, x: absX, y: absY, w: cw, h: ch });
            }
        }
        ranked.sort((a, b) => b.score - a.score);
        const limited = MAX_CHUNKS_PER_BLOCK > 0 ? ranked.slice(0, MAX_CHUNKS_PER_BLOCK) : ranked;
        for (const r of limited) {
            candidates.push(r);
        }
    }

    // Global photo suppression and budgeted extraction
    candidates.sort((a, b) => b.score - a.score);
    const budgeted = candidates.slice(0, MAX_TOTAL_CHUNKS);

    for (const c of budgeted) {
        // Optional: fast photo suppression by variance (skip very uniform or very saturated regions)
        const varianceOk = await passesVarianceCheck(image, c.x, c.y, c.w, c.h);
        if (!varianceOk) continue;
        try {
            // Add small padding around each crop to provide OCR with additional context
            const PAD = Number(process.env.CROP_PAD_PX || 8);
            const imgW = metadata.width as number;
            const imgH = metadata.height as number;
            const left = Math.max(0, c.x - PAD);
            const top = Math.max(0, c.y - PAD);
            const width = Math.min(c.w + PAD * 2, imgW - left);
            const height = Math.min(c.h + PAD * 2, imgH - top);
            // Flatten transparency onto white background before OCR to avoid "empty" results
            const chunkBuffer = await image
                .clone()
                .extract({ left, top, width, height })
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .png()
                .toBuffer();
            logger.info(`Chunk ${chunkIndex} dims ${width}x${height} bytes=${chunkBuffer.length}`);
            result.push({ data: chunkBuffer, index: chunkIndex++, position: { x: left, y: top, width, height } });
        } catch (e) {
            logger.error(`Error extracting candidate at (${c.x}, ${c.y}): ${e}`);
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

// Simple variance check to filter out photo-like or uniform regions
async function passesVarianceCheck(
    image: sharp.Sharp,
    left: number,
    top: number,
    width: number,
    height: number
): Promise<boolean> {
    try {
        const tW = 48, tH = 48;
        const buf = await image.clone().extract({ left, top, width, height }).grayscale().resize({ width: tW, height: tH, fit: 'fill' }).raw().toBuffer();
        // Compute normalized variance
        let sum = 0, sum2 = 0;
        for (let i = 0; i < buf.length; i++) { sum += buf[i]; sum2 += buf[i] * buf[i]; }
        const n = buf.length;
        const mean = sum / n / 255;
        const varN = (sum2 / n - (sum / n) * (sum / n)) / (255 * 255);
        // Very low variance likely blank; extremely high variance + high saturation would be photo, but we only test variance here
        return varN >= PHOTO_VARIANCE_THRESHOLD;
    } catch {
        return true;
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