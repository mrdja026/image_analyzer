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
            updatedAt: now
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
        res.on('close', () => {
            set.delete(res);
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
    }
}

export const jobManager = new JobManager();

