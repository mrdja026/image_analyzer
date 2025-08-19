import { JobState, JobStage, SseEvent } from './types';
import { v4 as uuidv4 } from 'uuid';
import { Response } from 'express';

export class JobManager {
    private jobs: Map<string, JobState> = new Map();
    private streams: Map<string, Set<Response>> = new Map();

    createJob(): JobState {
        const id = uuidv4();
        const now = Date.now();
        const job: JobState = {
            id,
            stage: 'idle',
            createdAt: now,
            updatedAt: now,
            tokensTotal: 0,
            tokensWindow: 0,
            lastTickMs: now
        };
        this.jobs.set(id, job);
        this.streams.set(id, new Set());
        return job;
    }

    getJob(id: string): JobState | undefined {
        return this.jobs.get(id);
    }

    updateJob(id: string, updates: Partial<JobState>): JobState | undefined {
        const job = this.jobs.get(id);
        if (!job) return undefined;
        const merged = { ...job, ...updates, updatedAt: Date.now() } as JobState;
        this.jobs.set(id, merged);
        return merged;
    }

    deleteJob(id: string): void {
        // Stop and clear any running token timer
        const job = this.jobs.get(id);
        if (job?.tokenTimer) {
            clearInterval(job.tokenTimer);
        }
        this.jobs.delete(id);
        const set = this.streams.get(id);
        if (set) {
            for (const res of set) {
                try { res.end(); } catch { }
            }
        }
        this.streams.delete(id);
    }

    attachStream(id: string, res: Response): void {
        const set = this.streams.get(id);
        if (!set) return;
        set.add(res);
        // Start token timer when first subscriber attaches
        if (set.size === 1) {
            this.startTokenTimer(id);
        }
        res.on('close', () => {
            set.delete(res);
            // Stop token timer when last subscriber detaches
            if (set.size === 0) {
                this.stopTokenTimer(id);
            }
        });
    }

    emit(id: string, event: SseEvent): void {
        const set = this.streams.get(id);
        if (!set) return;
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const res of set) {
            res.write(data);
        }
    }

    setStage(id: string, stage: JobStage): void {
        this.updateJob(id, { stage });
        this.emit(id, { type: 'stage', stage });
        if (stage === 'finished' || stage === 'error') {
            this.stopTokenTimer(id);
        }
    }

    // Increment token counters from streaming LLM
    incrementTokens(id: string, tokens: number): void {
        const job = this.jobs.get(id);
        if (!job) return;
        const total = (job.tokensTotal ?? 0) + (tokens || 0);
        const window = (job.tokensWindow ?? 0) + (tokens || 0);
        this.jobs.set(id, { ...job, tokensTotal: total, tokensWindow: window });
    }

    // Start a per-job timer to emit token rate at fixed cadence
    private startTokenTimer(id: string, intervalMs: number = 1000): void {
        const job = this.jobs.get(id);
        if (!job) return;
        if (job.tokenTimer) return; // already running

        let lastTickMs = job.lastTickMs ?? Date.now();
        const timer = setInterval(() => {
            const j = this.jobs.get(id);
            if (!j) return;

            const now = Date.now();
            const dtMs = Math.max(1, now - (lastTickMs ?? now));
            const windowTokens = j.tokensWindow ?? 0;
            const rate = windowTokens / (dtMs / 1000);

            // Emit rounded rate and cumulative total
            this.emit(id, {
                type: 'tokens',
                rate: Math.round(rate),
                total: j.tokensTotal ?? 0
            });

            // Reset window and advance clock
            lastTickMs = now;
            this.jobs.set(id, {
                ...j,
                tokensWindow: 0,
                lastTickMs: now
            });
        }, intervalMs);

        this.jobs.set(id, { ...job, tokenTimer: timer, lastTickMs });
    }

    private stopTokenTimer(id: string): void {
        const job = this.jobs.get(id);
        if (!job) return;
        if (job.tokenTimer) {
            clearInterval(job.tokenTimer);
        }
        this.jobs.set(id, { ...job, tokenTimer: undefined });
    }
}

export const jobManager = new JobManager();

