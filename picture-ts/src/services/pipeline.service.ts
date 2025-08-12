import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '../lib/logger';
import ollamaService from './ollama.service';
import { scrapeContent, ScrapeResult } from './scraper.service';
import { writeImagesMarkdown } from './save-markdown.service';
import { Role } from '../types';
import { DEFAULT_OUTPUT_DIR } from '../config';

export class PipelineService {
    constructor() { }

    /**
     * Scrape a URL and return the cleaned textual content. Optionally save to disk.
     */
    async runScrapePipeline(args: { url: string; save?: boolean; output?: string }): Promise<{ text: string; images: ScrapeResult['images']; textPath: string | null; imagesPath: string | null; }> {
        const { url, save, output } = args;
        logger.info(`Starting scrape pipeline for URL: ${url}`);
        const { text, images } = await scrapeContent(url);
        let textPath: string | null = null;
        let imagesPath: string | null = null;
        if (save && output) {
            textPath = await this.saveMarkdown(`% Scrape Result\n\n**Source:** <${url}>\n\n\n${text}\n`, output, 'scrape_result.md');
            imagesPath = await writeImagesMarkdown(url, images, this.getOutputDir(output));
        }
        return { text, images, textPath, imagesPath };
    }

    /**
     * Scrape a URL and then analyze it using the text model and role prompt.
     */
    async runAnalysisFromUrl(args: { url: string; role?: Role; textModel?: string; save?: boolean; output?: string }): Promise<{ analysis: string; textPath: string | null; imagesPath: string | null; analysisPath: string | null; }> {
        const { url, role = 'marketing', save, output } = args;
        logger.info(`Starting analyze-from-url pipeline for URL: ${url} with role: ${role}`);
        const { text, images, textPath, imagesPath } = await this.runScrapePipeline({ url, save, output });
        const analysis = await ollamaService.analyzeDocument(text, role);
        let analysisPath: string | null = null;
        if (save && output) {
            analysisPath = await this.saveMarkdown(`% Analysis Result\n\n**Source:** <${url}>\n**Role:** ${role}\n\n\n${analysis}\n`, output, `analysis_${role}.md`);
        }
        return { analysis, textPath, imagesPath, analysisPath };
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

    private async saveMarkdown(content: string, outputDir: string, filename: string): Promise<string> {
        const dir = this.getOutputDir(outputDir);
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, filename);
        await fs.writeFile(filePath, content, 'utf-8');
        logger.info(`Saved result to ${filePath}`);
        return filePath;
    }

    // Image-pipeline save helper removed
}

export default new PipelineService();