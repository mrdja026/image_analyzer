## **Feature Specification: Simplify and Stabilize the Content Detection Pipeline**

### **1. High-Level Goal & Context**

The current implementation of our `detectContentBlocks` function in `image.service.ts` is an overly complex, "F1-engine" solution that has proven to be too brittle and sensitive for real-world, varied layouts like the Bosch blog post. It frequently fails to detect any content, causing the entire pipeline to fall back to a less effective, grid-based approach.

The goal of this task is to **refactor and simplify** this function, removing the unnecessary complexity and returning to the original, more robust design. We will replace the complex, dynamically-sized morphological kernel with a more direct, reliable method of finding content.

### **2. The Core Problem: The "Ghost" in the Machine**

The root cause of the failures is the `cv.morphologyEx` step and its associated dynamic `kernel`. This was an over-engineered component that was not part of the original, successful design. It attempts to be "clever" by merging words into text blocks, but in practice, it is too sensitive to layout variations and often fails completely. This complexity is the source of the pipeline's brittleness.

### **3. The Solution: A Return to First Principles**

We will strip the function down to its essential, reliable core. The new, simplified workflow will be:
1.  Load the image.
2.  Convert to grayscale.
3.  Apply a high-contrast binary threshold (`cv.threshold`).
4.  **Find contours directly on this clean, thresholded image.**

This removes the fragile, unpredictable morphological step and relies on the most fundamental and robust technique in computer vision: identifying blobs of non-white pixels.

### **4. The Implementation Plan: Find and Replace**

You are to perform a direct "find and replace" operation within the `src/services/image.service.ts` file.

---

#### **A. FIND this exact `detectContentBlocks` function:**

```typescript
export async function detectContentBlocks(
    imageBuffer: Buffer,
    metadata: sharp.Metadata
): Promise<{ x: number, y: number, width: number, height: number }[]> {
    if (!ENABLE_OPENCV) {
        return [];
    }

    try {
        const cv = await loadOpenCV();

        const origWidth = metadata.width as number;
        const origHeight = metadata.height as number;
        if (!origWidth || !origHeight) return [];

        const aspectRatio = origHeight / Math.max(1, origWidth);
        const scale = aspectRatio >= OPENCV_TALL_ASPECT_RATIO ? OPENCV_TALL_DOWNSCALE : (DETECT_SCALE > 0 ? DETECT_SCALE : 1.0);

        const srcRGBA = new cv.Mat(origHeight, origWidth, cv.CV_8UC4);
        srcRGBA.data.set(imageBuffer);

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

        const inset = OPENCV_EDGE_INSET;
        const bordered = new cv.Mat();
        const white = new cv.Scalar(255, 255, 255, 255);
        cv.copyMakeBorder(proc, bordered, inset, inset, inset, inset, cv.BORDER_CONSTANT, white);

        const gray = new cv.Mat();
        cv.cvtColor(bordered, gray, cv.COLOR_RGBA2GRAY, 0);
        const blurred = new cv.Mat();
        const blurK = new cv.Size(3, 3);
        cv.GaussianBlur(gray, blurred, blurK, 0, 0, cv.BORDER_DEFAULT);
        const bin = new cv.Mat();
        cv.threshold(blurred, bin, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

        const kernelW = Math.max(OPENCV_KERNEL_MIN_W, Math.min(OPENCV_KERNEL_MAX_W, Math.floor(proc.cols / 40)));
        const kernelH = OPENCV_KERNEL_BASE_H;
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelW, kernelH));
        const morph = new cv.Mat();
        cv.morphologyEx(bin, morph, cv.MORPH_CLOSE, kernel);

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const inv = 1 / scale;
        const blocks: { x: number, y: number, width: number, height: number }[] = [];
        for (let i = 0; i < contours.size(); ++i) {
            const rect = cv.boundingRect(contours.get(i));
            const x = Math.max(0, Math.round((rect.x - inset) * inv));
            const y = Math.max(0, Math.round((rect.y - inset) * inv));
            const w = Math.round(rect.width * inv);
            const h = Math.round(rect.height * inv);

            const cx = Math.min(Math.max(0, x), origWidth - 1);
            const cy = Math.min(Math.max(0, y), origHeight - 1);
            const cw = Math.max(0, Math.min(w, origWidth - cx));
            const ch = Math.max(0, Math.min(h, origHeight - cy));

            if (cw < OPENCV_MIN_BLOCK_W || ch < OPENCV_MIN_BLOCK_H) continue;
            if (cw >= Math.floor(origWidth * OPENCV_MAX_WIDTH_FRAC) && ch >= Math.floor(origHeight * OPENCV_MAX_HEIGHT_FRAC)) continue;
            blocks.push({ x: cx, y: cy, width: cw, height: ch });
        }

        contours.delete(); hierarchy.delete(); morph.delete(); kernel.delete?.(); bin.delete(); blurred.delete(); gray.delete(); bordered.delete();
        if (proc !== srcRGBA) proc.delete();
        srcRGBA.delete();

        logger.info(`OpenCV detection: blocks=${blocks.length} kernel=${kernelW}x${kernelH} scale=${scale.toFixed(2)} aspect=${aspectRatio.toFixed(2)}`);
        return blocks.sort((a, b) => a.y - b.y);
    } catch (error) {
        return [];
    }
}
```

---

#### **B. And REPLACE it with this new, simplified, and robust version:**

```typescript
/**
 * Uses computer vision to detect logical content blocks in an image.
 * This simplified version removes the complex morphological step for better robustness.
 * @param imageBuffer The raw RGBA image buffer from sharp.
 * @param metadata The sharp metadata containing width and height.
 * @param debug A flag to enable saving of the intermediate vision mask.
 * @returns An array of bounding boxes for content blocks.
 */
export async function detectContentBlocks(
    imageBuffer: Buffer, 
    metadata: sharp.Metadata,
    debug = false
): Promise<{x: number, y: number, width: number, height: number}[]> {
    if (!ENABLE_OPENCV) {
        return [];
    }

    try {
        const cv = await loadOpenCV();
        
        // Load the image buffer into an OpenCV Mat.
        const mat = new cv.Mat(metadata.height, metadata.width, cv.CV_8UC4);
        mat.data.set(imageBuffer);
        
        // 1. Pre-processing: Convert to grayscale and apply a binary threshold.
        // This is the core of the content detection logic.
        const gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY, 0);
        
        const thresh = new cv.Mat();
        cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

        // 2. (REMOVED) The complex cv.morphologyEx step has been removed.
        // We will find contours on the clean, thresholded image directly.

        // 3. Debug Hook: Save the intermediate threshold mask for visual inspection.
        if (debug && OPENCV_DEBUG_EXPORT) {
            try {
                const maskBuffer = await sharp(Buffer.from(thresh.data), {
                    raw: { width: thresh.cols, height: thresh.rows, channels: 1 }
                }).png().toBuffer();
                await fs.writeFile('debug_thresh_mask.png', maskBuffer);
                logger.info('✅ Saved debug vision mask to debug_thresh_mask.png');
            } catch (e) {
                logger.error(`Failed to save debug image: ${e}`);
            }
        }
        
        // 4. Find contours on the simple, thresholded image.
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // 5. Filter and Extract Bounding Boxes
        const contentBlocks: {x: number, y: number, width: number, height: number}[] = [];
        for (let i = 0; i < contours.size(); ++i) {
            const contour = contours.get(i);
            const rect = cv.boundingRect(contour);

            // Use a simpler, more permissive filter for this robust method.
            if (rect.width > OPENCV_MIN_BLOCK_W && rect.height > OPENCV_MIN_BLOCK_H && rect.width < metadata.width * OPENCV_MAX_WIDTH_FRAC) {
                contentBlocks.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }
            contour.delete();
        }

        // Clean up all OpenCV memory allocations.
        mat.delete(); gray.delete(); thresh.delete(); contours.delete(); hierarchy.delete();

        // Sort blocks by their top-to-bottom reading order for logical processing.
        return contentBlocks.sort((a, b) => a.y - b.y);

    } catch (error) {
        logger.error(`Error in detectContentBlocks: ${error}`);
        return []; // Return an empty array on failure.
    }
}
```

---

### **5. Final Acceptance Criteria**

*   The `detectContentBlocks` function is now significantly simpler, containing no `cv.morphologyEx` or dynamic `kernel` logic.
*   When run on the problematic Bosch blog image, the function should now successfully detect content blocks and not fall back to the grid-based approach.
*   The overall `chunkImage` function should produce clean, logically coherent chunks, leading to a successful and non-hallucinated OCR result.
*   The `debug` flag should produce a `debug_thresh_mask.png` file that clearly shows the black-and-white "ink" mask of the page content.