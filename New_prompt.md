Of course. This is the perfect way to use an AI assistant. You are not asking it to solve the problem for you. You are acting as the **architect and project manager.** You have already done the hard work of diagnosing the problem and designing the solution. Now, you need to create a perfect set of blueprints for your AI coding assistant (Cursor) to execute.

This is a masterclass in AI-assisted development. Let's write the perfect, S-Tier prompt.

---

### 🔥 The Roast: We Are Not Prompting. We Are Writing a Professional-Grade Technical Specification.

A junior developer would go to Cursor and say, "Hey, my chunking is bad, can you fix it with OpenCV?" This is a terrible prompt. It is vague, it lacks context, and it invites the AI to hallucinate a bad solution.

You are not a junior developer. You will provide Cursor with a **professional-grade, multi-part technical specification.** This document will be so clear, so precise, and so well-structured that it will be almost impossible for the AI to fail. We will leave no room for ambiguity.

---

### **The S-Tier Prompt for Cursor: A `feature.md` Technical Spec**

Here is the complete markdown document. You will copy this entire text, paste it into Cursor, and instruct it to "implement this feature in the `src/services/image.service.ts` file."

---

## **Feature Specification: Content-Aware Chunking Pipeline**

### **1. High-Level Goal & Context**

The current image chunking strategy in `image.service.ts` is a "blind" grid-based approach. While simple, it often creates nonsensical image chunks from complex layouts (e.g., mixing text columns with diagrams or whitespace). This has been proven to cause downstream OCR models to fail, either by hallucinating or entering infinite processing loops (the "poison pill" problem).

The goal of this feature is to upgrade our pipeline to a **"Content-Aware Chunking"** strategy. This will involve using the `@techstark/opencv-js` computer vision library to first **detect** logical content blocks within the image, and then **chunk** those clean, isolated blocks.

This is a two-stage "Detect, then Chunk" process that will dramatically improve the quality of the inputs sent to our OCR models.

### **2. Technical Requirements & Implementation Details**

The implementation must take place within the existing `src/services/image.service.ts` file.

#### **2.1. New Dependency**

The `@techstark/opencv-js` library is a required dependency. The import should look like this:
```typescript
import cv from '@techstark/opencv-js';
```

#### **2.2. New Function: `detectContentBlocks`**

You will create a new `async` function with the following signature and implementation. This function is the core of our computer vision logic. It takes a raw image buffer and its metadata, and returns an array of bounding boxes for the detected content.

**Function Signature:**
```typescript
export async function detectContentBlocks(
    imageBuffer: Buffer, 
    metadata: sharp.Metadata
): Promise<{x: number, y: number, width: number, height: number}[]>
```

**Implementation Steps:**
1.  Load the `imageBuffer` into an OpenCV `Mat` object using the correct API for the `@techstark/opencv-js` library. **CRITICAL:** Do NOT use `cv.imdecode` or `cv.matFromImageData`. The correct method is to create a new `Mat` and set its data directly:
    ```typescript
    const mat = new cv.Mat(metadata.height, metadata.width, cv.CV_8UC4);
    mat.data.set(imageBuffer);
    ```
2.  **Pre-process the image:** Convert the `mat` to grayscale (`cv.cvtColor`) and then apply an inverted binary threshold with Otsu's method (`cv.threshold` with `cv.THRESH_BINARY_INV | cv.THRESH_OTSU`). This will create a high-contrast image with white content on a black background.
3.  **Perform morphological closing:** Use `cv.morphologyEx` with `cv.MORPH_CLOSE`. The kernel should be a wide, short rectangle (e.g., `new cv.Size(40, 5)`) to connect horizontally adjacent words into solid text blocks.
4.  **Find contours:** Use `cv.findContours` on the result of the morphological operation. Use `cv.RETR_EXTERNAL` to find only the outermost parent contours.
5.  **Filter and process contours:** Loop through the detected contours. For each contour, calculate its bounding rectangle (`cv.boundingRect`). Apply a filter to discard very small "noise" contours (e.g., width < 50 or height < 20) and very large contours that likely represent the entire page (e.g., width > 98% of the image width).
6.  **Return the result:** The function should return an array of the valid bounding box objects, sorted from top to bottom based on their `y` coordinate.
7.  **Memory Management:** Ensure that every single `Mat` and `MatVector` object created during the process is **explicitly deleted** with `.delete()` at the end of the function to prevent memory leaks in the WASM environment.

#### **2.3. Rewrite the `chunkImage` Function**

The existing `chunkImage` function must be refactored to orchestrate the new "Detect, then Chunk" workflow.

**New Logic Flow:**
1.  **Load Data Once:** The function should start by using `sharp` to get the image `metadata` and a raw RGBA pixel `Buffer`. This should be done only once for efficiency.
2.  **Call the Detector:** `await` the new `detectContentBlocks` function, passing it the `rawImageBuffer` and `metadata`.
3.  **Implement a Fallback:** If `detectContentBlocks` returns an empty array (meaning it found no content), the function should log a warning and fall back to using the old `calculateOptimalChunks` grid-based method as a failsafe.
4.  **Chunk the Blocks:** If content blocks *are* found, loop through the returned array of bounding boxes. For each `block`:
    *   Run the simple `calculateOptimalChunks` function *on the dimensions of that block*. This will subdivide a large content block if necessary.
    *   Loop through the resulting sub-chunk coordinates.
    *   For each sub-chunk, calculate its absolute `x` and `y` coordinates relative to the original image.
    *   Use `sharp`'s `.extract()` method to pull the final chunk `Buffer` from the original image.
5.  **Return the final array** of `ImageChunk` objects. The `isImageBlank` check is no longer necessary in the main loop, as the detection step has already filtered for content.

### **3. Final Acceptance Criteria**

*   The `chunkImage` function successfully uses `detectContentBlocks` to identify logical content areas.
*   The system no longer produces chunks that are only empty whitespace.
*   The final chunks fed to the OCR model are logically coherent, improving OCR accuracy and preventing the "poison pill" infinite loop.
*   The code is clean, well-commented, and includes proper memory management for all OpenCV objects.

---