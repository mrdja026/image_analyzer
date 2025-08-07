export type JobStage = 'idle' | 'chunking' | 'ocr' | 'combining' | 'analyzing' | 'finished' | 'error';

export interface JobState {
    id: string;
    stage: JobStage;
    imagePath?: string;
    combinedText?: string;
    result?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
}

export type SseEvent =
    | { type: 'stage'; stage: JobStage }
    | { type: 'progress'; current: number; total?: number; message?: string }
    | { type: 'tokens'; tokens: number }
    | { type: 'message'; message: string }
    | { type: 'done'; result?: string }
    | { type: 'error'; error: string };

