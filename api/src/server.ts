import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';

// Import pipeline and services from picture-ts
import { pipelineService, ollamaService } from '@blog-reviews/picture';
import { jobManager } from './jobManager';
import { createSseTracker } from './sseTracker';
import type { Role } from '@blog-reviews/picture';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

// Simple server logger
function log(message: string, meta?: Record<string, unknown>) {
    const time = new Date().toISOString();
    if (meta) {
        // Avoid JSON errors on circular
        try {
            console.log(`[api ${time}] ${message} ${JSON.stringify(meta)}`);
        } catch {
            console.log(`[api ${time}] ${message}`);
        }
    } else {
        console.log(`[api ${time}] ${message}`);
    }
}

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
    log(`REQ ${req.method} ${req.originalUrl}`);
    next();
});

// Storage for uploads
const uploadDir = path.resolve(process.cwd(), 'uploads');
const storage = multer.diskStorage({
    destination: async (_req: Request, _file: Express.Multer.File, cb: (err: any, dest: string) => void) => {
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (_req: Request, file: Express.Multer.File, cb: (err: any, name: string) => void) => {
        cb(null, `${Date.now()}_${file.originalname}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// Health
app.get('/api/health', (_req: Request, res: Response) => {
    log('Health check');
    res.json({ ok: true });
});

// SSE stream
app.get('/api/stream/:jobId', (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = jobManager.getJob(jobId);
    if (!job) {
        log('SSE connect failed: job not found', { jobId });
        return res.status(404).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    jobManager.attachStream(jobId, res);
    log('SSE connected', { jobId });
    // Send initial stage
    jobManager.emit(jobId, { type: 'stage', stage: job.stage });
});

// Upload and run OCR+combine
app.post('/api/upload', upload.single('image'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            log('Upload missing file');
            return res.status(400).json({ error: 'image file is required' });
        }
        const job = jobManager.createJob();
        jobManager.updateJob(job.id, { imagePath: req.file.path });
        log('Upload accepted', { jobId: job.id, file: req.file.path, size: req.file.size });
        res.status(202).json({ jobId: job.id });

        // Kick off async processing
        setImmediate(async () => {
            try {
                jobManager.setStage(job.id, 'chunking');
                log('Chunking started', { jobId: job.id, file: req.file!.path });
                const tracker = createSseTracker(job.id);
                pipelineService.setProgressTracker(tracker);

                // Run OCR pipeline only
                jobManager.setStage(job.id, 'ocr');
                log('OCR started', { jobId: job.id });
                const combinedText = await pipelineService.runOcrPipeline({
                    path: req.file!.path,
                    progress: 'spinner',
                    noProgress: false,
                    save: false,
                    showTimeElapsed: true,
                    showTokensPerSecond: true
                });

                jobManager.updateJob(job.id, { combinedText });
                jobManager.setStage(job.id, 'combining');
                log('OCR complete, text combined', { jobId: job.id, textLength: combinedText?.length || 0 });
                jobManager.emit(job.id, { type: 'message', message: 'OCR complete' });
                jobManager.emit(job.id, { type: 'done' });
                jobManager.setStage(job.id, 'finished');
            } catch (err: any) {
                log('Upload processing error', { jobId: job.id, error: String(err?.stack || err) });
                jobManager.updateJob(job.id, { stage: 'error', error: String(err?.message || err) });
                jobManager.emit(job.id, { type: 'error', error: String(err?.message || err) });
            }
        });
    } catch (e: any) {
        log('Upload handler error', { error: String(e?.stack || e) });
        res.status(500).json({ error: e?.message || 'Internal error' });
    }
});

// Analyze using role or custom prompt
app.post('/api/analyze', async (req: Request, res: Response) => {
    try {
        const { jobId, role, prompt } = req.body as { jobId: string; role?: Role; prompt?: string };
        if (!jobId) {
            log('Analyze missing jobId');
            return res.status(400).json({ error: 'jobId is required' });
        }
        const job = jobManager.getJob(jobId);
        if (!job) {
            log('Analyze job not found', { jobId });
            return res.status(404).json({ error: 'job not found' });
        }
        if (!job.combinedText) {
            log('Analyze called before OCR done', { jobId });
            return res.status(400).json({ error: 'OCR not complete for this job' });
        }

        res.status(202).json({ accepted: true });

        setImmediate(async () => {
            try {
                const tracker = createSseTracker(jobId);
                pipelineService.setProgressTracker(tracker);
                jobManager.setStage(jobId, 'analyzing');
                log('Analyze started', { jobId, role: role || null, hasCustomPrompt: Boolean(prompt) });
                let result: string;
                if (prompt && prompt.trim().length > 0) {
                    result = await ollamaService.analyzeWithPrompt(job.combinedText!, prompt);
                } else {
                    result = await ollamaService.analyzeDocument(job.combinedText!, (role || 'marketing') as Role);
                }
                jobManager.updateJob(jobId, { result });
                jobManager.emit(jobId, { type: 'done', result });
                jobManager.setStage(jobId, 'finished');
                log('Analyze finished', { jobId, resultLength: result?.length || 0 });
            } catch (err: any) {
                log('Analyze error', { jobId, error: String(err?.stack || err) });
                jobManager.updateJob(jobId, { stage: 'error', error: String(err?.message || err) });
                jobManager.emit(jobId, { type: 'error', error: String(err?.message || err) });
            }
        });
    } catch (e: any) {
        log('Analyze handler error', { error: String(e?.stack || e) });
        res.status(500).json({ error: e?.message || 'Internal error' });
    }
});

// Global error logging
process.on('uncaughtException', (err) => {
    log('uncaughtException', { error: String((err as any)?.stack || err) });
});
process.on('unhandledRejection', (reason) => {
    log('unhandledRejection', { error: String((reason as any)?.stack || reason) });
});

app.listen(port, () => {
    log(`API listening on http://localhost:${port}`);
});


