/**
 * Constants and configuration values for the picture-ts package.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config();

// Log the loaded configuration for debugging
console.log(`[Config] Loading environment variables from .env file`);
console.log(`[Config] API_URL: ${process.env.API_URL || 'not set, using default'}`);
console.log(`[Config] VISION_MODEL: ${process.env.VISION_MODEL || 'not set, using default'}`);
console.log(`[Config] TEXT_MODEL: ${process.env.TEXT_MODEL || 'not set, using default'}`);
console.log(`[Config] ENABLE_OPENCV: ${process.env.ENABLE_OPENCV === '1' ? 'enabled' : 'disabled'}`);
if (process.env.OPENCV_WASM_PATH) {
    console.log(`[Config] OPENCV_WASM_PATH: ${process.env.OPENCV_WASM_PATH}`);
}

// API configuration
export const API_URL = process.env.API_URL || 'http://localhost:11434/api/generate';
export const DEFAULT_TIMEOUT = 300; // seconds - increased from 60 to 300 to handle large text processing
export const REQUEST_COOLDOWN = 1.0; // Seconds between API requests (rate limiting)
export const MAX_RETRIES = 3; // Maximum number of retry attempts

// Image validation
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB limit
export const SUPPORTED_FORMATS = ['jpeg', 'jpg', 'png', 'gif'];

// Model configuration
//tried nanonets-ocr-s:latest, but it was too slow and not as accurate
//tried llava with temp 0 but it nonsense
//tried moondream:latest it was just innacurate
export const VISION_MODEL = process.env.VISION_MODEL || 'qwen2-ocr2-2b:latest'; // Using more powerful model for better analysis
//using mistral for text summarization since i quantitazed it and compiled the weights via lama.cpp
export const TEXT_MODEL = process.env.TEXT_MODEL || 'Mistral-7B-Instruct-v0.2-Q4_K_M:latest'; // Model for text summarization

// Progress display configuration
export const PROGRESS_STYLES = ['simple', 'bar', 'spinner', 'none'] as const;
export type ProgressStyle = typeof PROGRESS_STYLES[number];
export const DEFAULT_PROGRESS_STYLE: ProgressStyle = 'spinner';
export const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const PROGRESS_BAR_LENGTH = 40;
export const PROGRESS_REFRESH_RATE = 0.1; // seconds
export const TOKEN_RATE_WINDOW = 5.0; // Calculate token rate over this many seconds

// Estimated tokens for different models
export const ESTIMATED_TOKENS: Record<string, number> = {
    'yasserrmd/Nanonets-OCR-s:latest': 800, // Higher estimate for detailed OCR output
    'llava:13b': 300,
    'llava:34b': 500,
    'llama3': 200,
    'llama3:8b': 200,
    'llama3:instruct': 200,
    'llava:13b-v1.6': 800, // More powerful model for better analysis
    'mixtral': 300,
    'command-r': 300,
    'qwen:32b': 800, // Higher estimate for detailed qwen summarization output
    'my-mistral-instruct:latest': 800, // Higher estimate for detailed mistral summarization output
};

// Default prompts
export const DEFAULT_ANALYSIS_PROMPT = 'Extract all text content from the provided image. Preserve the original structure and formatting in markdown.';

// Chunk processing prompts
export const CHUNK_ANALYSIS_PROMPT = `Analyze the attached image.`; // this needs to be changed to a more specifcif prompt for chunk analysis depending on a model and modelfile configs, it works now with the current models in the config.ts

export const CHUNK_COMBINE_PROMPT = `Synthesize the following sequence of text chunks into a single, coherent markdown document. The chunks were extracted in order from a larger image. Your task is to intelligently merge overlapping text to ensure smooth transitions and eliminate redundancy. The final output must be only the fully assembled markdown document.

TEXT CHUNKS:
"""
{chunks_text}
"""
`;

// Strict OCR prompts to force raw transcription only
export const OCR_STRICT_MODE = (process.env.OCR_STRICT_MODE || '1') === '1';
export const OCR_STRICT_PROMPT = `Transcribe ONLY the visible text from the image. Preserve line breaks and ordering. Do NOT describe images, scenes, people, or layout. Do NOT add markdown/code fences or explanations. Output plain text only. If no text is visible, output exactly: EMPTY.`;
export const OCR_COMBINE_STRICT_PROMPT = `Merge the provided chunk texts strictly in order. Remove overlaps and duplicates. Output ONLY the merged raw text. Do not add, infer, or describe anything.`;

// Default guardrails for OCR generation
export const OCR_TEMPERATURE = Number(process.env.OCR_TEMPERATURE || 0.0);
export const OCR_TOP_P = Number(process.env.OCR_TOP_P || 0.1);
export const OCR_TOP_K = Number(process.env.OCR_TOP_K || 20);
export const OCR_NUM_PREDICT = Number(process.env.OCR_NUM_PREDICT || 1024);
export const OCR_STOP = (process.env.OCR_STOP || '```,Photo,Image,Figure,The image,This image').split(',').map(s => s.trim()).filter(Boolean);

// Role options for summarization
export const ROLES = ['marketing', 'po'] as const;
export type Role = typeof ROLES[number];
export const DEFAULT_ROLE: Role = 'marketing';

// Marketing Manager prompt
export const MARKETING_MANAGER_PROMPT = `
ROLE: Senior Marketing Manager
TASK: Analyze the provided document and generate a concise competitive analysis report. Be blunt and direct.

STEP 1: VALIDATION
First, validate the document. If it is empty, less than 50 words, or clearly not a technology blog post, respond with ONLY the following error message:
"Error: The provided document is invalid or insufficient for analysis."

STEP 2: ANALYSIS
If the document is valid, generate a report using the following structure.

**Analysis Report**

**1. Product Identity:** What is this product or service in one clear sentence?
**2. Core Value Proposition:** What is the main problem it solves for its users?
**3. Target Audience:** Who is this product designed for?
**4. Key Capabilities Mentioned:** List the 3-5 most prominent features, technologies, or services advertised.
**5. Content Effectiveness:** Does the blog post effectively convey the value of the product? Provide a brief, blunt justification.
**6. Final Recommendation:** Is this noteworthy for our strategy? Provide a brief justification.

DOCUMENT TO ANALYZE:
"""
{document_text}
"""
`;

// Product Owner prompt

export const PO_PROMPT = `
ROLE: You are a pragmatic, data-driven senior Product Owner.
TASK: Analyze the following document and distill it into a concise, actionable "Product Opportunity Brief." Your analysis must be grounded in the provided text, but you are expected to make logical inferences about strategy and risk.

**Product Opportunity Brief: [Infer the Product/Feature Name from the text]**

---

### 1. The Elevator Pitch (Product Vision)
*   **What is it?** In one clear, compelling sentence, what is this product, and what is its core mission?
*   **For Whom?** Who is the primary target user persona? (e.g., "For enterprise software developers...")
*   **What is the Key Value?** What is the single most important benefit it provides? (...who need to improve software reliability.")

---

### 2. The Core Loop (Problem & Solution)
*   **User Problem:** What specific, painful user problem does this product solve? Be precise.
*   **Proposed Solution:** How does this product's approach or key feature directly solve that problem?

---

### 3. Core Epics & Capabilities
*   List the 3-5 most essential product features described in the text. Frame them as high-level "Epics" that a development team could understand (e.g., "Epic: Automated Code Refactoring," "Epic: Real-time Translation Engine").

---

### 4. Strategic Analysis
*   **Evidence of Priority:** Based on the emphasis and detail in the text, which of the epics listed above seems to be the most critical or central to the product's strategy? *This is an inference, not a final decision.*
*   **Market Differentiation:** Does the document suggest how this product is different from or better than existing solutions?
*   **Key Risks & Unanswered Questions:** What critical information is MISSING? What are the biggest risks or unanswered questions a product team would have before starting development? (e.g., "Scalability is not addressed," "No mention of the underlying data source," "The business model is unclear").

---

**DOCUMENT TO ANALYZE:**
"""
{document_text}
"""
`;



// Default prompt - will be selected based on role argument
export const DEFAULT_SUMMARIZATION_PROMPT = MARKETING_MANAGER_PROMPT;

// Chunking settings
// Chunking presets: grid-first per reason.md (OpenCV slicer disabled by default)
// See reason.md for rationale: OpenCV.js disabled to simplify pipeline and improve portability.
export const DEFAULT_CHUNK_MAX_DIM = Number(process.env.CHUNK_MAX_DIM || 800);
export const DEFAULT_CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || 0.3);

// File paths
export const DEFAULT_OUTPUT_DIR = 'results';
export const LOG_DIR = 'logs';
export const LOG_FILE = path.join(LOG_DIR, 'image_analyzer.log');

// Create a mapping from role to prompt
export const ROLE_PROMPTS: Record<Role, string> = {
    marketing: MARKETING_MANAGER_PROMPT,
    po: PO_PROMPT,
};

// Helper function to get prompt by role
export function getPromptByRole(role: Role): string {
    return ROLE_PROMPTS[role] || DEFAULT_SUMMARIZATION_PROMPT;
}

// Feature flags for slicer selection
// Per reason.md: keep OpenCV.js disabled by default, but allow enabling via env for experiments.
export const ENABLE_OPENCV = process.env.ENABLE_OPENCV === '1';
export const OPENCV_WASM_PATH = process.env.OPENCV_WASM_PATH || '';
// Optional downscale factor for OpenCV content detection to reduce WASM memory usage on large images
export const DETECT_SCALE = Math.max(0.1, Math.min(1.0, Number(process.env.DETECT_SCALE || 0.85)));

// Chunk budgeting and subdivision tuning
export const MAX_TOTAL_CHUNKS = Number(process.env.MAX_TOTAL_CHUNKS || 60);
// Treat blocks with both dimensions <= CHUNK_MAX_DIM * FACTOR as single-chunk
export const BLOCK_SINGLETON_DIM_FACTOR = Number(process.env.BLOCK_SINGLETON_DIM_FACTOR || 1.2);
// Use a smaller overlap when chunking inside detected blocks
export const INBLOCK_OVERLAP = Number(process.env.INBLOCK_OVERLAP || 0.12);
// Coarse grid fallback when needing to reduce total chunk count
export const COARSE_GRID_MAX_DIM = Number(process.env.COARSE_GRID_MAX_DIM || 1200);
export const COARSE_GRID_OVERLAP = Number(process.env.COARSE_GRID_OVERLAP || 0.1);

// Text-density filtering to prioritize text-heavy regions
export const MIN_INK_FRACTION = Math.max(0, Math.min(1, Number(process.env.MIN_INK_FRACTION || 0.1)));
export const BLOCK_INK_MULTIPLIER = Math.max(1, Number(process.env.BLOCK_INK_MULTIPLIER || 2.0));
export const MAX_CHUNKS_PER_BLOCK = Math.max(0, Number(process.env.MAX_CHUNKS_PER_BLOCK || 3));
export const PHOTO_VARIANCE_THRESHOLD = Math.max(0, Math.min(1, Number(process.env.PHOTO_VARIANCE_THRESHOLD || 0.03)));