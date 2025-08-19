import * as path from 'path';
import * as fs from 'fs/promises';
import logger from '../lib/logger';
import ollamaService from './ollama.service';
import { scrapeContent, ScrapeResult, ImageInfo } from './scraper.service';
import { writeImagesMarkdown } from './save-markdown.service';
import { Role } from '../types';
import { DEFAULT_OUTPUT_DIR } from '../config';
import { downloadImage } from './image-download.service';
import { runVisionCaption } from './ocr.service';

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
     * Score images by context relevance to the page text.
     */
    private scoreImagesByContext(images: ImageInfo[], pageText: string): Array<{ img: ImageInfo; score: number; }> {
        const keywords = Array.from(new Set(pageText.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 6))).slice(0, 50);
        const scoreOf = (s?: string) => {
            if (!s) return 0;
            const low = s.toLowerCase();
            let score = 0;
            for (const k of keywords) {
                if (low.includes(k)) score += 1;
            }
            return score;
        };
        return images.map(img => {
            const sizeBonus = (img.width || 0) * (img.height || 0) > 0 ? Math.log10(((img.width || 0) * (img.height || 0)) + 1) : 0;
            const ctxScore = scoreOf(img.alt) + scoreOf(img.caption) + scoreOf(img.heading) + scoreOf(img.nearText);
            const orderPenalty = img.index != null ? -0.001 * img.index : 0; // earlier images get tiny bonus
            return { img, score: ctxScore + sizeBonus + orderPenalty };
        });
    }

    /**
     * Scrape a URL and then analyze it using the text model and role prompt.
     */
    async runAnalysisFromUrl(args: {
        url: string; role?: Role; textModel?: string; save?: boolean; output?: string; vision?: {
            baseUrl: string;
            model: string;
            provider: 'ollama' | 'llamacpp';
            system?: string;
            maxTokens?: number;
            maxImages?: number; // limit number of images to caption (default 1)
        }
    }): Promise<{ analysis: string; textPath: string | null; imagesPath: string | null; analysisPath: string | null; usedImages: Array<{ src: string; alt?: string; heading?: string; nearText?: string; caption?: string; ocr?: string; }>; }> {
        const { url, role = 'marketing', save, output, vision } = args;
        logger.info(`Starting analyze-from-url pipeline for URL: ${url} with role: ${role}`);
        const { text, images, textPath, imagesPath } = await this.runScrapePipeline({ url, save, output });

        // Optionally run vision caption/OCR on a few context-relevant images and append to the analysis input
        let visionAppendix = '';
        let usedImages: Array<{ src: string; alt?: string; heading?: string; nearText?: string; caption?: string; ocr?: string; }> = [];
        if (vision && images.length) {
            try {
                // Score by context; pick top 3
                const maxImages = Math.max(0, Math.min(Number.isFinite(vision.maxImages as number) ? (vision.maxImages as number) : 1, images.length));
                const scored = this.scoreImagesByContext(images as ImageInfo[], text)
                    .sort((a, b) => b.score - a.score)
                    .slice(0, maxImages)
                    .map(s => s.img);

                const localFiles: string[] = [];
                const mapSrcToFile = new Map<string, string>();
                for (const m of scored) {
                    try {
                        const p = await downloadImage(m.src);
                        localFiles.push(p);
                        mapSrcToFile.set(m.src, p);
                    } catch (e) {
                        logger.warn(`Failed to download image ${m.src}: ${String(e)}`);
                    }
                }

                if (localFiles.length) {
                    const captions = await runVisionCaption(
                        localFiles,
                        'Describe the image in detail and transcribe any visible text. Output Markdown only.',
                        {
                            baseUrl: vision.baseUrl,
                            model: vision.model,
                            provider: vision.provider,
                            system: vision.system,
                            maxTokens: vision.maxTokens,
                        }
                    );

                    // Pair captions back to images by index order
                    usedImages = scored.slice(0, captions.length).map((img, i) => ({
                        src: img.src,
                        alt: img.alt,
                        heading: img.heading,
                        nearText: img.nearText,
                        caption: img.caption,
                        ocr: captions[i]
                    }));

                    if (captions.length) {
                        visionAppendix = `\n\n---\n\n### Image Captions & OCR\n${usedImages
                            .map((u, i) => `**Image ${i + 1}:** ${u.alt ? `(${u.alt})` : ''}  \n${u.ocr}`)
                            .join('\n')}\n`;
                    }
                }
            } catch (e) {
                logger.error(`Vision caption failed: ${String(e)}`);
            }
        }

        const analysis = await ollamaService.analyzeDocument(`${text}${visionAppendix}`, role, args.textModel);
        let analysisPath: string | null = null;
        if (save && output) {
            // Include images block in the saved analysis file for full traceability
            const imagesBlock = usedImages.length
                ? `\n\n---\n\n## Images Used\n${usedImages.map((u, i) => (
                    `### Image ${i + 1}\n` +
                    `${u.alt ? `Alt: ${u.alt}\n` : ''}` +
                    `${u.heading ? `Nearest Heading: ${u.heading}\n` : ''}` +
                    `${u.nearText ? `Nearby Text: ${u.nearText}\n` : ''}` +
                    `${u.caption ? `Figure Caption: ${u.caption}\n` : ''}` +
                    `URL: <${u.src}>\n` +
                    `\n![image](${u.src})\n`
                )).join('\n')}
                `
                : '';

            const content = `% Analysis Result\n\n**Source:** <${url}>\n**Role:** ${role}\n\n\n${analysis}${imagesBlock}\n`;
            analysisPath = await this.saveMarkdown(content, output, `analysis_${role}.md`);
        }
        return { analysis, textPath, imagesPath, analysisPath, usedImages };
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