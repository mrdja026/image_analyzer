import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '../lib/logger';
import ollamaService from './ollama.service';
import { scrapeContent } from './scraper.service';
import { Role } from '../types';
import { DEFAULT_OUTPUT_DIR } from '../config';

export class PipelineService {
    constructor() { }

    /**
     * Scrape a URL and return the cleaned textual content. Optionally save to disk.
     */
    async runScrapePipeline(args: { url: string; save?: boolean; output?: string }): Promise<string> {
        const { url, save, output } = args;
        logger.info(`Starting scrape pipeline for URL: ${url}`);
        const text = await scrapeContent(url);
        if (save && output) {
            await this.saveResult(text, output, 'scrape_result.md');
        }
        return text;
    }

    /**
     * Scrape a URL and then analyze it using the text model and role prompt.
     */
    async runAnalysisFromUrl(args: { url: string; role?: Role; textModel?: string; save?: boolean; output?: string }): Promise<string> {
        const { url, role = 'marketing', save, output } = args;
        logger.info(`Starting analyze-from-url pipeline for URL: ${url} with role: ${role}`);
        const text = await scrapeContent(url);
        const analysis = await ollamaService.analyzeDocument(text, role);
        if (save && output) {
            await this.saveResult(analysis, output, `analysis_${role}.md`);
        }
        return analysis;
    }

    private getOutputDir(outputDir?: string): string {
        return path.resolve(process.cwd(), outputDir || DEFAULT_OUTPUT_DIR);
    }

    private async saveResult(content: string, outputDir: string, filename: string): Promise<void> {
        try {
            const dir = this.getOutputDir(outputDir);
            await fs.mkdir(dir, { recursive: true });
            const filePath = path.join(dir, filename);
            await fs.writeFile(filePath, content, 'utf-8');
            logger.info(`Saved result to ${filePath}`);
        } catch (error) {
            logger.error(`Error saving result to ${filename}: ${error}`);
        }
    }

    // Image-pipeline save helper removed
}

export default new PipelineService();