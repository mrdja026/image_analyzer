import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3001;

function log(message: string, meta?: Record<string, unknown>) {
    const time = new Date().toISOString();
    if (meta) {
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

app.use((req, _res, next) => {
    log(`REQ ${req.method} ${req.originalUrl}`);
    next();
});

// Health
app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
});

// Analyze a URL by spawning the CLI (picture-ts)
app.post('/api/analyze-url', async (req: Request, res: Response) => {
    try {
        const { url, role = 'marketing', textModel, vision } = req.body || {};
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'url is required' });
        }

        const outDir = path.join(process.cwd(), 'results', randomUUID());
        const args: string[] = [
            path.join('dist', 'main.js'),
            'analyze-url',
            url,
            '--role',
            String(role),
            '--save',
            '--output',
            outDir,
        ];

        if (textModel) args.push('--text-model', String(textModel));
        if (vision?.baseUrl && vision?.model && vision?.provider) {
            args.push('--vision-base-url', String(vision.baseUrl));
            args.push('--vision-model', String(vision.model));
            args.push('--vision-provider', String(vision.provider));
            if (vision.system) args.push('--vision-system', String(vision.system));
            if (vision.maxTokens) args.push('--vision-max-tokens', String(vision.maxTokens));
            if (vision.maxImages) args.push('--vision-max-images', String(vision.maxImages));
        }

        // Run the CLI with cwd pointing to picture-ts
        const cliCwd = path.resolve(process.cwd(), '../picture-ts');
        const child = spawn(process.execPath, args, { cwd: cliCwd });

        const logs: string[] = [];
        child.stdout.on('data', (d) => logs.push(d.toString()));
        child.stderr.on('data', (d) => logs.push(d.toString()));

        child.on('close', async (code) => {
            if (code !== 0) {
                return res.status(500).json({ error: 'analysis_failed', code, logs });
            }
            const chosenRole = String(role || 'marketing');
            const analysisPath = path.join(outDir, `analysis_${chosenRole}.md`);
            const scrapePath = path.join(outDir, 'scrape_result.md');
            const imagesPath = path.join(outDir, 'images.md');
            const [analysis, scrape, images] = await Promise.allSettled([
                fs.readFile(analysisPath, 'utf8'),
                fs.readFile(scrapePath, 'utf8'),
                fs.readFile(imagesPath, 'utf8'),
            ]);
            res.json({
                status: 'ok',
                outputDir: outDir,
                files: { analysisPath, scrapePath, imagesPath },
                contents: {
                    analysis: analysis.status === 'fulfilled' ? analysis.value : null,
                    scrape: scrape.status === 'fulfilled' ? scrape.value : null,
                    images: images.status === 'fulfilled' ? images.value : null,
                },
                logs,
            });
        });
    } catch (e: any) {
        log('Analyze handler error', { error: String(e?.stack || e) });
        res.status(500).json({ error: e?.message || 'Internal error' });
    }
});

process.on('uncaughtException', (err) => {
    log('uncaughtException', { error: String((err as any)?.stack || err) });
});
process.on('unhandledRejection', (reason) => {
    log('unhandledRejection', { error: String((reason as any)?.stack || reason) });
});

function start() {
    app.listen(port, () => {
        log(`API listening on http://localhost:${port}`);
    });
}

start();


