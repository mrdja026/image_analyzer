Best Practices for Text Extraction with OpenCV (from Web Knowledge): Based on standard practices (e.g., from OpenCV docs, Stack Overflow, and tutorials like PyImageSearch), text extraction typically involves:
Preprocessing: Grayscale, noise reduction (Gaussian blur), edge detection (Canny/Sobel) before thresholding.
Thresholding: Adaptive (Gaussian/Mean) for varying lighting; Otsu for bimodal histograms; combine with binary inversion for dark text on light backgrounds.
Morphology: Use dilation/erosion to connect text components; elliptical kernels for curved text; opening/closing to remove noise/artifacts.
Contour Detection: Filter contours by size/aspect ratio to avoid noise; use hierarchy for nested text blocks.
Advanced Alternatives: EAST text detector or MSER for better accuracy on natural scenes (but these add complexity/WASM overhead).
Common Pitfalls: Overly aggressive morphology can merge unrelated regions; poor thresholding on gradients causes missed/hallucinated blocks; no handling for rotated text or colors.
In your case, the code's basic approach (no edge detection, fixed kernels) likely causes issues on the test image (a dark-themed webpage screenshot with mixed text/graphics), leading to fragmented or inaccurate blocks.