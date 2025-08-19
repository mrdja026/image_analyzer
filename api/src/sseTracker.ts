import type { ProgressOptions, ProgressTracker } from '@blog-reviews/picture';
import { jobManager } from './jobManager';

export class SseProgressTracker implements ProgressTracker {
    private jobId: string;
    private total: number;
    private current: number;

    constructor(jobId: string) {
        this.jobId = jobId;
        this.total = 100;
        this.current = 0;
    }

    start(options: ProgressOptions): void {
        this.total = options.total ?? 100;
        this.current = 0;
        jobManager.emit(this.jobId, { type: 'progress', current: 0, total: this.total, message: options.title });
    }

    update(current: number, message?: string | undefined): void {
        this.current = current;
        jobManager.emit(this.jobId, { type: 'progress', current: this.current, total: this.total, message });
    }

    updateTokens(tokens: number): void {
        // Accumulate tokens to be emitted at a fixed cadence by the JobManager timer
        jobManager.incrementTokens(this.jobId, tokens);
    }

    finish(message?: string | undefined): void {
        jobManager.emit(this.jobId, { type: 'message', message: message || 'done' });
    }
}

export function createSseTracker(jobId: string): ProgressTracker {
    return new SseProgressTracker(jobId);
}

