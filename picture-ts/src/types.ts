/**
 * Type definitions for the picture-ts package
 */

// Role types
export type Role = 'marketing' | 'po';

// Progress style types
export type ProgressStyle = 'simple' | 'bar' | 'spinner' | 'none';

// Image formats
export type SupportedImageFormat = 'jpeg' | 'jpg' | 'png' | 'gif';

// Image chunk interface
export interface ImageChunk {
    data: Buffer;
    index: number;
    position: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

// Ollama API request types
export interface OllamaRequestBase {
    model: string;
    stream: boolean;
    options?: {
        temperature?: number;
        top_p?: number;
        top_k?: number;
    };
}

export interface OllamaTextRequest extends OllamaRequestBase {
    prompt: string;
}

export interface OllamaImageRequest extends OllamaRequestBase {
    prompt: string;
    images: string[]; // Base64 encoded images
}

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

// CLI argument types
export interface AnalyzeCommandArgs {
    path: string;
    role?: Role;
    prompt?: string;
    visionModel?: string;
    textModel?: string;
    debug?: boolean;
    save?: boolean;
    progress?: ProgressStyle;
    noProgress?: boolean;
    chunkSize?: number;
    overlap?: number;
    output?: string;
    forceChunk?: boolean;
    saveChunks?: boolean;
    showTokensPerSecond?: boolean;
    showTimeElapsed?: boolean;
}

export interface OcrCommandArgs {
    path: string;
    visionModel?: string;
    debug?: boolean;
    save?: boolean;
    progress?: ProgressStyle;
    noProgress?: boolean;
    chunkSize?: number;
    overlap?: number;
    output?: string;
    forceChunk?: boolean;
    saveChunks?: boolean;
    showTokensPerSecond?: boolean;
    showTimeElapsed?: boolean;
}

// Progress tracking types
export interface ProgressOptions {
    style: ProgressStyle;
    total?: number;
    title?: string;
    showTokensPerSecond?: boolean;
    showTimeElapsed?: boolean;
}

export interface ProgressTracker {
    start(options: ProgressOptions): void;
    update(current: number, message?: string): void;
    updateTokens(tokens: number): void;
    finish(message?: string): void;
} 