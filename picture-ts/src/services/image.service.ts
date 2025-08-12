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
    ENABLE_CHUNK_PREPROCESS,
    USE_ADAPTIVE_THRESHOLD,
    ADAPTIVE_BLOCK_SIZE,
    ADAPTIVE_C,
    MIN_BAND_HEIGHT,
    USE_MORPHOLOGY,
    MAX_UI_SOLIDITY,
    MIN_EDGE_DENSITY,
    SAVE_ETL_OVERLAYS,
    DETECT_SCALE,
    BLOCK_SINGLETON_DIM_FACTOR,
    INBLOCK_OVERLAP,
    MAX_CHUNKS_PER_BLOCK,
    MAX_TOTAL_CHUNKS
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

        // Decide working resolution for detection
        const scaleFactor = Math.max(0.1, Math.min(1.0, Number((DETECT_SCALE as unknown) as number) || 1.0));
        let workGray = gray;
        let workWidth = gray.cols;
        let workHeight = gray.rows;
        if (scaleFactor < 1.0) {
            const resized = new cv.Mat();
            const dsize = new cv.Size(Math.max(1, Math.round(gray.cols * scaleFactor)), Math.max(1, Math.round(gray.rows * scaleFactor)));
            cv.resize(gray, resized, dsize, 0, 0, cv.INTER_AREA);
            workGray = resized;
            workWidth = resized.cols;
            workHeight = resized.rows;
        }

        // Apply Gaussian blur to reduce noise
        const blurred = new cv.Mat();
        cv.GaussianBlur(workGray, blurred, new cv.Size(3, 3), 0, 0);

        // Create binary mask with adaptive or Otsu thresholding
        const binaryMask = new cv.Mat();
        if (USE_ADAPTIVE_THRESHOLD) {
            cv.adaptiveThreshold(
                blurred,
                binaryMask,
                255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY_INV,
                ADAPTIVE_BLOCK_SIZE,
                ADAPTIVE_C
            );
        } else {
            cv.threshold(blurred, binaryMask, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
        }

        // Calculate edge map for textness scoring
        const edges = new cv.Mat();
        cv.Canny(workGray, edges, 100, 200, 3, false);

        // Save debug artifacts if requested
        if (debug && OPENCV_DEBUG_EXPORT) {
            const debugDir = 'results/etl_debug';
            await fs.mkdir(debugDir, { recursive: true });

            // Save the preprocessed grayscale image
            const grayBuffer = await sharp(Buffer.from(workGray.data), {
                raw: { width: workWidth, height: workHeight, channels: 1 }
            }).png().toBuffer();
            await fs.writeFile(`${debugDir}/gray.png`, grayBuffer);

            // Save the thresholded image
            const binaryBuffer = await sharp(Buffer.from(binaryMask.data), {
                raw: { width: binaryMask.cols, height: binaryMask.rows, channels: 1 }
            }).png().toBuffer();
            await fs.writeFile(`${debugDir}/binary_mask.png`, binaryBuffer);

            // Save edge map
            const edgesBuffer = await sharp(Buffer.from(edges.data), {
                raw: { width: edges.cols, height: edges.rows, channels: 1 }
            }).png().toBuffer();
            await fs.writeFile(`${debugDir}/edges.png`, edgesBuffer);

            logger.info(`✅ Saved ETL debug images to ${debugDir}/`);
        }

        // Find contours directly from binary mask
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(binaryMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // Create collections for valid/rejected blocks
        const contentBlocks: { x: number, y: number, width: number, height: number }[] = [];
        const rejectedBlocks: { x: number, y: number, width: number, height: number, reason: string }[] = [];

        // Horizontal expansion factor (make blocks wider)
        const HORIZONTAL_EXPANSION = 0.15; // Expand width by 15%

        // Minimum aspect ratio (width/height) to ensure blocks aren't too tall and skinny
        const MIN_ASPECT_RATIO = 0.5; // Width should be at least half the height

        // Inspect contours and filter by geometry and textness
        // Scale-aware thresholds
        const minBlockW = Math.max(1, Math.floor(OPENCV_MIN_BLOCK_W * scaleFactor));
        const minBlockH = Math.max(1, Math.floor(OPENCV_MIN_BLOCK_H * scaleFactor));

        for (let i = 0; i < contours.size(); ++i) {
            const contour = contours.get(i);
            const rect = cv.boundingRect(contour);

            // Compute metrics to distinguish text from UI elements
            const contourArea = cv.contourArea(contour);
            const rectArea = rect.width * rect.height;
            const solidity = rectArea > 0 ? contourArea / rectArea : 0;

            // Extract ROI from edge map
            const edgeRoi = edges.roi(rect);
            const edgePixels = cv.countNonZero(edgeRoi);
            const edgeDensity = edgePixels / rectArea;
            edgeRoi.delete();

            // Calculate aspect ratio (width/height)
            const aspectRatio = rect.width / rect.height;

            // Apply various filters to reject UI elements
            if (rect.width < minBlockW || rect.height < minBlockH) {
                rejectedBlocks.push({ ...rect, reason: 'too_small' });
            } else if (rect.width > workWidth * OPENCV_MAX_WIDTH_FRAC) {
                rejectedBlocks.push({ ...rect, reason: 'too_wide' });
            } else if (solidity > MAX_UI_SOLIDITY && rect.width > 300 && rect.height > 200) {
                // High solidity + large box = likely UI panel
                rejectedBlocks.push({ ...rect, reason: 'ui_panel' });
            } else if (edgeDensity < MIN_EDGE_DENSITY && rectArea > 100000) {
                // Low edge density + large box = likely flat element
                rejectedBlocks.push({ ...rect, reason: 'low_textness' });
            } else {
                // Content block passed all filters
                // Apply horizontal expansion to make blocks wider
                const expandedWidth = Math.min(
                    workWidth - rect.x,  // Don't expand beyond image width
                    rect.width * (1 + HORIZONTAL_EXPANSION)
                );

                // If aspect ratio is too small (tall and skinny), expand width to meet minimum aspect ratio
                const finalWidth = aspectRatio < MIN_ASPECT_RATIO ?
                    Math.min(workWidth - rect.x, rect.height * MIN_ASPECT_RATIO) :
                    expandedWidth;

                // Scale back to original coordinates if needed
                const scaleBack = (v: number) => Math.max(0, Math.floor(v / scaleFactor));
                const wBack = Math.max(1, Math.floor(finalWidth / scaleFactor));
                const hBack = Math.max(1, Math.floor(rect.height / scaleFactor));
                const xBack = scaleBack(rect.x);
                const yBack = scaleBack(rect.y);

                // Clamp to original image bounds
                const xClamped = Math.min(xBack, Math.max(0, (metadata.width || 0) - 1));
                const yClamped = Math.min(yBack, Math.max(0, (metadata.height || 0) - 1));
                const wClamped = Math.min(wBack, Math.max(1, (metadata.width || 1) - xClamped));
                const hClamped = Math.min(hBack, Math.max(1, (metadata.height || 1) - yClamped));

                contentBlocks.push({ x: xClamped, y: yClamped, width: wClamped, height: hClamped });
            }

            contour.delete();
        }

        // Save block info for debugging
        if (debug && SAVE_ETL_OVERLAYS && contentBlocks.length + rejectedBlocks.length > 0) {
            // Create a color overlay to visualize blocks
            const overlay = new cv.Mat(metadata.height, metadata.width, cv.CV_8UC3, new cv.Scalar(0, 0, 0));

            // Draw rejected blocks in red with reason
            for (const block of rejectedBlocks) {
                cv.rectangle(
                    overlay,
                    new cv.Point(block.x, block.y),
                    new cv.Point(block.x + block.width, block.y + block.height),
                    new cv.Scalar(0, 0, 255), // Red
                    2  // Line thickness
                );

                cv.putText(
                    overlay,
                    block.reason,
                    new cv.Point(block.x + 5, block.y + 20),
                    cv.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    new cv.Scalar(0, 0, 255), // Red text
                    1 // Line thickness
                );
            }

            // Draw kept content blocks in green
            for (const block of contentBlocks) {
                cv.rectangle(
                    overlay,
                    new cv.Point(block.x, block.y),
                    new cv.Point(block.x + block.width, block.y + block.height),
                    new cv.Scalar(0, 255, 0), // Green
                    2  // Line thickness
                );
            }

            // Save overlay
            const overlayBuffer = await sharp(Buffer.from(overlay.data), {
                raw: { width: overlay.cols, height: overlay.rows, channels: 3 }
            }).png().toBuffer();
            await fs.writeFile('results/etl_debug/blocks_overlay.png', overlayBuffer);

            overlay.delete();
        }

        // If no good content blocks found, use projection-based strips
        if (contentBlocks.length === 0) {
            logger.info('No content blocks passed filters. Using row projection to create strips.');

            const width = morphed.cols;
            const height = morphed.rows;
            const rowSums: number[] = new Array(height).fill(0);

            // Sum white pixels per row (text is white in binary inverse)
            for (let y = 0; y < height; y++) {
                let sum = 0;
                for (let x = 0; x < width; x++) {
                    sum += morphed.ucharPtr(y, x)[0];
                }
                rowSums[y] = sum;
            }

            // Higher threshold for taller images
            const activationThreshold = 255 * width * (height > 5000 ? 0.015 : 0.02);
            let inRun = false;
            let runStart = 0;
            const strips: { start: number, end: number }[] = [];

            // First pass: identify all potential text strips
            for (let y = 0; y < height; y++) {
                const active = rowSums[y] >= activationThreshold;
                if (active && !inRun) {
                    inRun = true;
                    runStart = y;
                } else if (!active && inRun) {
                    strips.push({ start: runStart, end: y - 1 });
                    inRun = false;
                }
            }

            if (inRun) {
                strips.push({ start: runStart, end: height - 1 });
            }

            // Second pass: merge strips that are close together to reach MIN_BAND_HEIGHT
            const mergedStrips: { start: number, end: number }[] = [];
            let currentStrip = { start: -1, end: -1 };

            for (const strip of strips) {
                if (currentStrip.start === -1) {
                    currentStrip = { ...strip };
                } else if (strip.start - currentStrip.end < 50) {
                    // Merge if gap is small
                    currentStrip.end = strip.end;
                } else {
                    // Gap too large, finish current and start new
                    mergedStrips.push(currentStrip);
                    currentStrip = { ...strip };
                }
            }

            if (currentStrip.start !== -1) {
                mergedStrips.push(currentStrip);
            }

            // Third pass: ensure minimum height and create blocks (scale back to original)
            for (const strip of mergedStrips) {
                const h = strip.end - strip.start + 1;
                const targetH = h >= MIN_BAND_HEIGHT ? h : (Math.min(height - 1, strip.end + Math.ceil((MIN_BAND_HEIGHT - h) / 2)) - Math.max(0, strip.start - Math.ceil((MIN_BAND_HEIGHT - h) / 2)) + 1);
                const newStart = h >= MIN_BAND_HEIGHT ? strip.start : Math.max(0, strip.start - Math.ceil((MIN_BAND_HEIGHT - h) / 2));
                // Scale back to original
                const scaleBack = (v: number) => Math.max(0, Math.floor(v / scaleFactor));
                const xBack = 0;
                const yBack = scaleBack(newStart);
                const wBack = Math.max(1, Math.floor(width / scaleFactor));
                const hBack = Math.max(1, Math.floor(targetH / scaleFactor));
                const xClamped = Math.min(xBack, Math.max(0, (metadata.width || 0) - 1));
                const yClamped = Math.min(yBack, Math.max(0, (metadata.height || 0) - 1));
                const wClamped = Math.min(wBack, Math.max(1, (metadata.width || 1) - xClamped));
                const hClamped = Math.min(hBack, Math.max(1, (metadata.height || 1) - yClamped));
                contentBlocks.push({ x: xClamped, y: yClamped, width: wClamped, height: hClamped });
            }

            if (debug && SAVE_ETL_OVERLAYS) {
                // Visualize projection strips
                const stripOverlay = new cv.Mat(metadata.height, metadata.width, cv.CV_8UC3, new cv.Scalar(0, 0, 0));

                for (const block of contentBlocks) {
                    cv.rectangle(
                        stripOverlay,
                        new cv.Point(block.x, block.y),
                        new cv.Point(block.x + block.width, block.y + block.height),
                        new cv.Scalar(0, 0, 255), // Blue
                        2  // Line thickness
                    );
                }

                // Save strip overlay
                const stripBuffer = await sharp(Buffer.from(stripOverlay.data), {
                    raw: { width: stripOverlay.cols, height: stripOverlay.rows, channels: 3 }
                }).png().toBuffer();
                await fs.writeFile('results/etl_debug/strips_overlay.png', stripBuffer);

                stripOverlay.delete();
            }
        }

        // Clean up OpenCV resources
        mat.delete();
        gray.delete();
        blurred.delete();
        adaptiveThresh.delete();
        otsuThresh.delete();
        morphed.delete();
        edges.delete();
        if (workGray !== gray) {
            workGray.delete();
        }
        contours.delete();
        hierarchy.delete();

        // Log results and return sorted blocks
        logger.info(`ETL detected ${contentBlocks.length} content blocks and rejected ${rejectedBlocks.length} non-content blocks.`);
        return contentBlocks.sort((a, b) => a.y - b.y);
    } catch (error) {
        logger.error(`Error in detectContentBlocks: ${error}`);
        return [];
    }
}

export function calculateOptimalChunks(
    imageWidth: number, imageHeight: number, maxDim: number = DEFAULT_CHUNK_MAX_DIM, overlapPercent: number = DEFAULT_CHUNK_OVERLAP
): Array<[number, number, number, number]> {
    // Different overlap for horizontal vs vertical to prioritize horizontal chunking
    const horizontalOverlap = overlapPercent * 0.8; // Less overlap horizontally = wider chunks
    const verticalOverlap = overlapPercent * 1.2;   // More overlap vertically = shorter chunks

    // Calculate chunk dimensions
    // For blog posts, prefer wider chunks than tall ones when possible
    const aspectRatio = imageWidth / imageHeight;

    // If image is wider than tall, use square chunks
    // If image is taller than wide, use wider chunks
    let chunkWidth, chunkHeight;

    if (aspectRatio >= 1) {
        // Image is wider than tall or square
        chunkWidth = Math.min(maxDim, imageWidth);
        chunkHeight = Math.min(maxDim, imageHeight);
    } else {
        // Image is taller than wide - use wider chunks
        const widthFactor = Math.min(1.5, 1.0 / aspectRatio); // Up to 50% wider
        chunkWidth = Math.min(maxDim * widthFactor, imageWidth);
        chunkHeight = Math.min(maxDim, imageHeight);
    }

    // Calculate step sizes with different overlaps
    const stepX = Math.floor(chunkWidth * (1 - horizontalOverlap));
    const stepY = Math.floor(chunkHeight * (1 - verticalOverlap));

    const chunks: Array<[number, number, number, number]> = [];

    // Prioritize horizontal tiling by processing each row completely before moving to next row
    // This ensures we get complete horizontal coverage before moving down
    for (let y = 0; y < imageHeight; y += stepY) {
        for (let x = 0; x < imageWidth; x += stepX) {
            const extractWidth = Math.min(chunkWidth, imageWidth - x);
            const extractHeight = Math.min(chunkHeight, imageHeight - y);

            // Skip very small chunks
            if (extractWidth < 50 || extractHeight < 50) continue;

            if (extractWidth > 0 && extractHeight > 0) {
                chunks.push([x, y, extractWidth, extractHeight]);
            }
        }
    }

    // Remove duplicate chunks
    const uniqueKeys = new Set<string>();
    return chunks.filter(c => {
        const key = c.join(',');
        if (uniqueKeys.has(key)) return false;
        uniqueKeys.add(key);
        return true;
    });
}

export function mergeBlocks(blocks: { x: number, y: number, width: number, height: number }[]): { x: number, y: number, width: number, height: number }[] {
    if (blocks.length <= 1) return blocks;
    // Always enable block merging regardless of DISABLE_BLOCK_MERGE flag

    // Sort blocks by y-coordinate first, then x-coordinate
    const sorted = blocks.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const merged: { x: number, y: number, width: number, height: number }[] = [];

    // Different thresholds for horizontal vs vertical gaps
    const HORIZONTAL_GAP_THRESHOLD = 30; // More permissive horizontally (was 15)
    const VERTICAL_GAP_THRESHOLD = 10;   // More restrictive vertically (was 15)

    // Maximum vertical offset for considering horizontal merging
    // This helps merge blocks that are roughly on the same line
    const MAX_VERTICAL_OFFSET = 20;

    // First pass: merge blocks that are close horizontally and roughly on the same line
    for (const rect of sorted) {
        let mergedIn = false;

        for (let i = 0; i < merged.length; i++) {
            const m = merged[i];

            // Calculate horizontal and vertical gaps
            const dx = Math.max(0, Math.max(m.x, rect.x) - Math.min(m.x + m.width, rect.x + rect.width));
            const dy = Math.max(0, Math.max(m.y, rect.y) - Math.min(m.y + m.height, rect.y + rect.height));

            // Calculate vertical offset between the midpoints
            const mMidY = m.y + m.height / 2;
            const rectMidY = rect.y + rect.height / 2;
            const verticalOffset = Math.abs(mMidY - rectMidY);

            // Merge if horizontally close and roughly on the same line
            // OR if they overlap vertically and are horizontally close
            if ((dx <= HORIZONTAL_GAP_THRESHOLD && verticalOffset <= MAX_VERTICAL_OFFSET) ||
                (dy <= VERTICAL_GAP_THRESHOLD && dx <= HORIZONTAL_GAP_THRESHOLD)) {

                const nx = Math.min(m.x, rect.x);
                const ny = Math.min(m.y, rect.y);
                const nx2 = Math.max(m.x + m.width, rect.x + rect.width);
                const ny2 = Math.max(m.y + m.height, rect.y + rect.height);
                merged[i] = { x: nx, y: ny, width: nx2 - nx, height: ny2 - ny };
                mergedIn = true;
                break;
            }
        }

        if (!mergedIn) {
            merged.push({ ...rect });
        }
    }

    // Second pass: ensure minimum width-to-height ratio for all blocks
    const MIN_WIDTH_HEIGHT_RATIO = 1.0; // Width should be at least equal to height for blog-friendly blocks

    return merged.map(block => {
        const ratio = block.width / block.height;
        if (ratio < MIN_WIDTH_HEIGHT_RATIO) {
            // Expand width to meet minimum ratio
            const newWidth = Math.ceil(block.height * MIN_WIDTH_HEIGHT_RATIO);
            return {
                ...block,
                width: newWidth
            };
        }
        return block;
    });
}

export async function chunkImage(
    imagePath: string,
    maxDim: number = DEFAULT_CHUNK_MAX_DIM,
    overlapPercent: number = DEFAULT_CHUNK_OVERLAP,
    debugMode: boolean = false,
    maxTotalChunks?: number
): Promise<ImageChunk[]> {
    logger.info(`Chunking image with content-aware strategy: ${imagePath}`);
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const rawImageBuffer = await image.ensureAlpha().raw().toBuffer();
    if (!metadata.width || !metadata.height) throw new Error('Could not determine image dimensions');

    if (!ENABLE_OPENCV) {
        throw new Error('OpenCV ETL is disabled; set ENABLE_OPENCV=1 to enable ETL-driven chunking and avoid grid fallback.');
    }

    // Detect content blocks at potentially lower resolution (based on DETECT_SCALE)
    const contentBlocks = await detectContentBlocks(rawImageBuffer, metadata, debugMode);

    // If we used detection scaling, adjust coordinates back to original image scale
    if (DETECT_SCALE !== 1.0 && contentBlocks.length > 0) {
        const scaleMultiplier = 1.0 / DETECT_SCALE;
        logger.info(`Scaling ${contentBlocks.length} blocks from detection scale ${DETECT_SCALE} to original resolution (multiplier: ${scaleMultiplier})`);

        contentBlocks.forEach(block => {
            block.x = Math.floor(block.x * scaleMultiplier);
            block.y = Math.floor(block.y * scaleMultiplier);
            block.width = Math.ceil(block.width * scaleMultiplier);
            block.height = Math.ceil(block.height * scaleMultiplier);
        });

        // Save scaled blocks overlay for debugging (render at reduced resolution to reduce memory)
        if (debugMode) {
            await fs.mkdir('results/etl_debug', { recursive: true });
            const fullW = metadata.width as number;
            const fullH = metadata.height as number;
            const overlayW = Math.min(1024, fullW);
            const overlayH = Math.max(1, Math.round(overlayW * fullH / fullW));

            const debugSvg = Buffer.from(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${overlayW}" height="${overlayH}" viewBox="0 0 ${fullW} ${fullH}">` +
                contentBlocks.map(block =>
                    `<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" stroke="yellow" stroke-width="5" fill="none" />`
                ).join('') +
                '</svg>'
            );

            const debugOverlay = await sharp(debugSvg).png().toBuffer();
            await fs.writeFile('results/etl_debug/scaled_blocks.png', debugOverlay);
        }
    }

    if (contentBlocks.length === 0) {
        // Fallback to horizontal strips instead of a single chunk
        logger.warn('No ETL blocks detected. Using horizontal strips as fallback.');

        const result: ImageChunk[] = [];
        let chunkIndex = 0;

        // Calculate strip height based on image dimensions
        // For blog posts, we want wide but not too tall strips
        const stripHeight = Math.min(maxDim * 0.6, metadata.height / 3);
        const stripWidth = metadata.width;
        const stripOverlap = 0.2; // 20% overlap between strips
        const stepY = Math.floor(stripHeight * (1 - stripOverlap));

        // Create horizontal strips
        for (let y = 0; y < metadata.height; y += stepY) {
            const extractHeight = Math.min(stripHeight, metadata.height - y);
            if (extractHeight <= 0) continue;

            try {
                const chunkBuffer = await sharp(rawImageBuffer, { raw: { width: metadata.width, height: metadata.height, channels: 4 } })
                    .extract({ left: 0, top: y, width: stripWidth, height: extractHeight }).png().toBuffer();
                result.push({
                    data: chunkBuffer,
                    index: chunkIndex++,
                    position: { x: 0, y, width: stripWidth, height: extractHeight }
                });
            } catch (error) {
                logger.error(`Error extracting fallback strip at y=${y}: ${error}`);
            }
        }

        if (result.length === 0) {
            // Ultimate fallback: single chunk
            logger.warn('Horizontal strip fallback failed. Using single chunk as last resort.');
            const cw = Math.min(maxDim * 1.5, metadata.width);
            const ch = Math.min(maxDim * 0.8, metadata.height);
            const chunkBuffer = await sharp(rawImageBuffer, { raw: { width: metadata.width, height: metadata.height, channels: 4 } })
                .extract({ left: 0, top: 0, width: cw, height: ch }).png().toBuffer();
            return [{ data: chunkBuffer, index: 0, position: { x: 0, y: 0, width: cw, height: ch } }];
        }

        return result;
    }

    const mergedBlocks = mergeBlocks(contentBlocks);
    // Clamp merged blocks to image bounds to avoid out-of-range extracts
    const imageWidth = metadata.width as number;
    const imageHeight = metadata.height as number;
    const clampedBlocks = mergedBlocks
        .map(b => {
            const x = Math.max(0, Math.min(b.x, imageWidth - 1));
            const y = Math.max(0, Math.min(b.y, imageHeight - 1));
            const w = Math.max(1, Math.min(b.width, imageWidth - x));
            const h = Math.max(1, Math.min(b.height, imageHeight - y));
            return { x, y, width: w, height: h };
        })
        .filter(b => b.width > 0 && b.height > 0);

    const result: ImageChunk[] = [];
    let chunkIndex = 0;
    for (const block of clampedBlocks) {
        // Calculate aspect ratio to determine chunking strategy
        const blockAspect = block.width / block.height;

        // Adjust maxDim for this block based on aspect ratio
        // For tall blocks (height > width), use wider chunks
        let blockMaxWidth = maxDim;
        let blockMaxHeight = maxDim;

        // If block is taller than wide, make chunks wider to ensure horizontal coverage
        if (blockAspect < 1.0) {
            // Block is taller than wide
            const widthFactor = Math.min(2.0, 1.5 / blockAspect); // Up to 2x wider for very tall blocks
            blockMaxWidth = Math.min(block.width, maxDim * widthFactor);
        }

        // For very wide blocks, make chunks shorter to avoid skinny vertical slices
        if (blockAspect > 2.0) {
            // Block is much wider than tall
            blockMaxHeight = Math.min(block.height, maxDim * 0.8); // Slightly shorter chunks
        }

        // Treat small blocks as singletons to avoid over-tiling
        const singletonFactor = BLOCK_SINGLETON_DIM_FACTOR || 1.2;
        const isSingleton = (block.width <= maxDim * singletonFactor);
        const overlapInside = INBLOCK_OVERLAP || overlapPercent;

        // For singletons, use the entire block (but respect max dimensions)
        // For larger blocks, use our improved calculateOptimalChunks
        const blockChunksAll = isSingleton
            ? [[0, 0, Math.min(block.width, blockMaxWidth), Math.min(block.height, blockMaxHeight)] as [number, number, number, number]]
            : calculateOptimalChunks(block.width, block.height, Math.max(blockMaxWidth, blockMaxHeight), overlapInside);

        // Apply per-block cap to limit memory/tiles
        let blockChunks: Array<[number, number, number, number]> = blockChunksAll;
        const perBlockCap = Math.max(1, MAX_CHUNKS_PER_BLOCK || 4);
        if (blockChunksAll.length > perBlockCap) {
            // Sort chunks by area (largest first) to prioritize important content
            const sortedChunks = [...blockChunksAll].sort((a, b) => (b[2] * b[3]) - (a[2] * a[3]));
            blockChunks = sortedChunks.slice(0, perBlockCap);
        }

        // Filter out chunks with poor aspect ratio (too tall and skinny)
        const MIN_CHUNK_ASPECT = 0.5; // Width should be at least half the height
        blockChunks = blockChunks.filter(([_x, _y, w, h]) => w / h >= MIN_CHUNK_ASPECT);

        // If all chunks were filtered out, keep at least one (the widest)
        if (blockChunks.length === 0 && blockChunksAll.length > 0) {
            const widestChunk = [...blockChunksAll].sort((a, b) => b[2] - a[2])[0];
            blockChunks = [widestChunk];
        }

        for (const [cx, cy, cw, ch] of blockChunks) {
            // Compute absolute coordinates and clamp to image bounds
            let absoluteX = block.x + cx;
            let absoluteY = block.y + cy;
            absoluteX = Math.max(0, Math.min(absoluteX, imageWidth - 1));
            absoluteY = Math.max(0, Math.min(absoluteY, imageHeight - 1));
            const widthClamped = Math.max(1, Math.min(cw, imageWidth - absoluteX));
            const heightClamped = Math.max(1, Math.min(ch, imageHeight - absoluteY));

            // Skip very small chunks or chunks with bad aspect ratio
            if (widthClamped <= 50 || heightClamped <= 50 || widthClamped / heightClamped < MIN_CHUNK_ASPECT) {
                continue;
            }

            if (widthClamped <= 0 || heightClamped <= 0) {
                logger.warn(`Skipping out-of-bounds chunk at (${absoluteX}, ${absoluteY}) with size (${cw}x${ch}) after clamp.`);
                continue;
            }

            try {
                const chunkBuffer = await sharp(rawImageBuffer, { raw: { width: metadata.width, height: metadata.height, channels: 4 } })
                    .extract({ left: absoluteX, top: absoluteY, width: widthClamped, height: heightClamped }).png().toBuffer();
                result.push({ data: chunkBuffer, index: chunkIndex++, position: { x: absoluteX, y: absoluteY, width: widthClamped, height: heightClamped } });
            } catch (error) { logger.error(`Error extracting sub-chunk at (${absoluteX}, ${absoluteY}): ${error}`); }
        }
    }
    // Apply global chunk budget by subsampling evenly
    const budget = Math.max(1, maxTotalChunks || MAX_TOTAL_CHUNKS || 80);
    let finalChunks = result;
    if (result.length > budget) {
        const step = Math.ceil(result.length / budget);
        finalChunks = result.filter((_, idx) => idx % step === 0).slice(0, budget).map((chunk, idx2) => ({
            ...chunk,
            index: idx2,
        }));
        logger.warn(`Capped chunks from ${result.length} to ${finalChunks.length} (budget=${budget}).`);
    }

    logger.info(`Successfully created ${finalChunks.length} content-aware chunks.`);
    return finalChunks;
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