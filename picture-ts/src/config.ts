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
export const CHUNK_ANALYSIS_PROMPT = `Transcribe the text from the image. Preserve all original formatting including line breaks, spacing, and indentation. If the image contains code, enclose it in markdown backticks. If the image is blank or unreadable, return an empty string. Output only the transcribed text.`;

export const CHUNK_COMBINE_PROMPT = `Synthesize the following sequence of text chunks into a single, coherent markdown document. The chunks were extracted in order from a larger image. Your task is to intelligently merge overlapping text to ensure smooth transitions and eliminate redundancy. The final output must be only the fully assembled markdown document.

TEXT CHUNKS:
"""
{chunks_text}
"""
`;

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
You are a Product Owner analyzing extracted text content from a document. Based on the following text, provide a structured analysis focusing on product requirements and market fit.
Address these specific points directly:

1.  **Product Overview:** What is this product or service in one clear sentence?
2.  **User Problem:** What specific user problems does this product aim to solve?
3.  **Target Users:** Who are the primary and secondary user personas for this product?
4.  **Core Functionality:** List the 3-5 most essential features or capabilities required.
5.  **Development Priorities:** What features should be prioritized in the next development cycle?
6.  **Market Fit Assessment:** How well does this product align with market needs? Provide a brief assessment.
7.  **Technical Considerations:** Are there any specific technical requirements or constraints mentioned?

Present your analysis in a clear, actionable format suitable for a product backlog discussion.
`;

// Default prompt - will be selected based on role argument
export const DEFAULT_SUMMARIZATION_PROMPT = MARKETING_MANAGER_PROMPT;

// Chunking settings
export const DEFAULT_CHUNK_MAX_DIM = 1024; // A more standard size for vision models. 1200 is also fine.
export const DEFAULT_CHUNK_OVERLAP = 0.15; // 15-20% is a good range.

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