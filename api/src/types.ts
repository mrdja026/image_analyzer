export type JobStage = 'idle' | 'chunking' | 'ocr' | 'combining' | 'analyzing' | 'finished' | 'error';

export interface JobState {
    id: string;
    stage: JobStage;
    imagePath?: string;
    mode?: string; // threaded from UI for logging/visibility
    combinedText?: string;
    result?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
    // Token metrics for fixed-cadence SSE token rate reporting
    tokensTotal?: number;
    tokensWindow?: number;
    lastTickMs?: number;
    tokenTimer?: NodeJS.Timeout;
}

export type SseEvent =
    | { type: 'stage'; stage: JobStage }
    | { type: 'progress'; current: number; total?: number; message?: string }
    // Fixed-cadence token rate updates
    | { type: 'tokens'; rate: number; total?: number }
    | { type: 'message'; message: string }
    | { type: 'done'; result?: string }
    | { type: 'error'; error: string };

