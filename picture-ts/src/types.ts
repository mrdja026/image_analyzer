/**
 * Type definitions for the picture-ts package
 */

// Role types
export type Role = 'marketing' | 'po';

// Processing mode types (threaded from UI; currently informational only)
export type Mode = 'analyze' | 'describe' | 'summarize' | 'all';

// Progress UI types (used by lib/ui.ts)
export type ProgressStyle = 'simple' | 'bar' | 'spinner' | 'none';

export interface ProgressOptions {
    style: ProgressStyle;
    title?: string;
    total?: number;
    showTokensPerSecond?: boolean;
    showTimeElapsed?: boolean;
}

export interface ProgressTracker {
    start(options: ProgressOptions): void;
    update(current: number, message?: string): void;
    updateTokens(tokens: number): void;
    finish(message?: string): void;
}
export interface OllamaRequestBase {
    model: string;
    prompt: string;
    stream?: boolean;
    options?: {
        temperature?: number;
        // Add other valid Ollama options here as needed
    };
}

/**
 * A request that includes image data.
 */
export interface OllamaImageRequest extends OllamaRequestBase {
    images: string[];
}

/**
 * A request that is for text only (no image data).
 */
export interface OllamaTextRequest extends OllamaRequestBase {
    images?: never; // Explicitly forbid the 'images' property
}

/**
 * A unified type that can be EITHER a text request OR an image request.
 * This is the type our unified `makeRequest` function will use.
 */
export type OllamaRequest = OllamaImageRequest | OllamaTextRequest;


/**
 * The structure of a single chunk of a streamed response from Ollama.
 */
// Ollama API response types
export interface OllamaResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    context?: number[];
    total_duration?: number;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}
