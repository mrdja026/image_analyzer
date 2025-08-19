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
     * Extract key themes from content using the text model for semantic understanding.
     */
    private async extractKeyThemes(pageText: string, role: Role): Promise<string[]> {
        const prompt = `Analyze the following content and extract 3-5 key themes, topics, or concepts that would be most important for a ${role} analysis. Return only a simple list, one theme per line.

Content:
${pageText.substring(0, 2000)}${pageText.length > 2000 ? '...' : ''}`;

        try {
            const response = await ollamaService.analyzeWithPrompt('', prompt);
            const themes = response
                .split('\n')
                .map(line => line.replace(/^[-*•]\s*/, '').trim())
                .filter(line => line.length > 0 && line.length < 100)
                .slice(0, 5);

            logger.debug(`Extracted themes for ${role} analysis:`, themes);
            return themes;
        } catch (error) {
            logger.warn(`Failed to extract themes: ${error}`);
            // Fallback to basic keyword extraction
            return pageText.toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(w => w.length >= 6)
                .slice(0, 5);
        }
    }

    /**
     * Get quick descriptions of images using vision model for semantic understanding.
     */
    private async getQuickImageDescriptions(images: ImageInfo[], visionConfig: any): Promise<Array<{ img: ImageInfo; description: string; }>> {
        const results: Array<{ img: ImageInfo; description: string; }> = [];

        // Limit to first 10 images for quick pass to avoid overwhelming the system
        const imagesToProcess = images.slice(0, 10);

        for (const img of imagesToProcess) {
            try {
                logger.debug(`Getting quick description for: ${img.src}`);
                const p = await downloadImage(img.src);
                const description = await runVisionCaption(
                    [p],
                    'Describe this image in 1-2 sentences. Focus on the main subject and any text visible.',
                    {
                        baseUrl: visionConfig.baseUrl,
                        model: visionConfig.model,
                        provider: visionConfig.provider,
                        maxTokens: 100, // Short descriptions only
                    }
                );

                results.push({
                    img,
                    description: description[0] || ''
                });

                logger.debug(`Quick description: "${description[0]?.substring(0, 100)}..."`);
            } catch (error) {
                logger.warn(`Failed to get quick description for ${img.src}: ${error}`);
                results.push({
                    img,
                    description: img.alt || img.caption || ''
                });
            }
        }

        return results;
    }

    /**
     * Score images by semantic relevance using text model to understand content relationship.
     */
    private async scoreImagesBySemanticRelevance(
        imageDescriptions: Array<{ img: ImageInfo; description: string; }>,
        themes: string[],
        role: Role
    ): Promise<Array<{ img: ImageInfo; score: number; reasoning: string; }>> {
        const results: Array<{ img: ImageInfo; score: number; reasoning: string; }> = [];

        const themesList = themes.join(', ');

        for (const { img, description } of imageDescriptions) {
            try {
                const contextInfo = [
                    img.alt && `Alt text: ${img.alt}`,
                    img.caption && `Caption: ${img.caption}`,
                    img.heading && `Near heading: ${img.heading}`,
                    img.nearText && `Nearby text: ${img.nearText.substring(0, 200)}`,
                    description && `Visual content: ${description}`
                ].filter(Boolean).join('\n');

                const prompt = `Rate the relevance of this image for a ${role} analysis focused on themes: ${themesList}

Image information:
${contextInfo}

Rate relevance from 1-10 and explain why. Format: "Score: X - Reason"`;

                const response = await ollamaService.analyzeWithPrompt('', prompt);

                // Extract score and reasoning
                const scoreMatch = response.match(/score:\s*(\d+)/i);
                const score = scoreMatch ? parseInt(scoreMatch[1]) : 5;
                const reasoning = response.replace(/score:\s*\d+\s*-?\s*/i, '').trim();

                results.push({
                    img,
                    score,
                    reasoning
                });

                logger.debug(`Image relevance - Score: ${score}, Reasoning: ${reasoning.substring(0, 100)}...`);

            } catch (error) {
                logger.warn(`Failed to score image ${img.src}: ${error}`);
                // Fallback scoring
                const fallbackScore = (img.alt || img.caption || '').length > 0 ? 6 : 3;
                results.push({
                    img,
                    score: fallbackScore,
                    reasoning: 'Fallback scoring due to analysis error'
                });
            }
        }

        return results;
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
    }): Promise<{ analysis: string; textPath: string | null; imagesPath: string | null; analysisPath: string | null; usedImages: Array<{ src: string; alt?: string; heading?: string; nearText?: string; caption?: string; ocr?: string; relevanceScore?: number; relevanceReason?: string; }>; }> {
        const { url, role = 'marketing', save, output, vision } = args;
        logger.info(`Starting analyze-from-url pipeline for URL: ${url} with role: ${role}`);
        const { text, images, textPath, imagesPath } = await this.runScrapePipeline({ url, save, output });

        // Optionally run vision caption/OCR on a few context-relevant images and append to the analysis input
        let visionAppendix = '';
        let usedImages: Array<{ src: string; alt?: string; heading?: string; nearText?: string; caption?: string; ocr?: string; relevanceScore?: number; relevanceReason?: string; }> = [];

        // Debug logging for vision configuration
        logger.debug(`Vision config: ${JSON.stringify(vision)}, Images found: ${images.length}`);

        if (vision && images.length) {
            logger.debug(`Starting semantic vision processing with config: baseUrl=${vision.baseUrl}, model=${vision.model}, maxImages=${vision.maxImages}`);
            try {
                const maxImages = Math.max(0, Math.min(Number.isFinite(vision.maxImages as number) ? (vision.maxImages as number) : 1, images.length));
                logger.debug(`MaxImages calculated: ${maxImages}, Total images available: ${images.length}`);

                // Step 1: Extract key themes from content
                logger.debug(`Extracting key themes for ${role} analysis...`);
                const themes = await this.extractKeyThemes(text, role);

                // Step 2: Get quick descriptions of all images
                logger.debug(`Getting quick descriptions for ${images.length} images...`);
                const imageDescriptions = await this.getQuickImageDescriptions(images as ImageInfo[], vision);

                // Step 3: Score images by semantic relevance
                logger.debug(`Scoring images by semantic relevance to themes: ${themes.join(', ')}`);
                const semanticScores = await this.scoreImagesBySemanticRelevance(imageDescriptions, themes, role);

                // Step 4: Select top images by relevance score
                const scored = semanticScores
                    .sort((a, b) => b.score - a.score)
                    .slice(0, maxImages)
                    .map(s => s.img);

                logger.debug(`Selected ${scored.length} images for detailed vision processing:`,
                    semanticScores.slice(0, maxImages).map(s => `${s.img.src.substring(0, 50)}... (score: ${s.score})`));

                const localFiles: string[] = [];
                const mapSrcToFile = new Map<string, string>();
                for (const m of scored) {
                    try {
                        logger.debug(`Downloading image: ${m.src}`);
                        const p = await downloadImage(m.src);
                        localFiles.push(p);
                        mapSrcToFile.set(m.src, p);
                        logger.debug(`Successfully downloaded image to: ${p}`);
                    } catch (e) {
                        logger.warn(`Failed to download image ${m.src}: ${String(e)}`);
                    }
                }

                logger.debug(`Downloaded ${localFiles.length} images successfully, starting vision processing`);

                if (localFiles.length) {
                    logger.debug(`Calling vision model ${vision.model} at ${vision.baseUrl} to process ${localFiles.length} images`);
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
                    logger.debug(`Vision processing completed, received ${captions.length} captions`);
                    logger.debug(`Caption contents:`, captions.map((c, i) => `[${i}]: "${c.substring(0, 100)}${c.length > 100 ? '...' : ''}"`));

                    // Pair captions back to images with semantic reasoning
                    const selectedScores = semanticScores.slice(0, captions.length);
                    usedImages = scored.slice(0, captions.length).map((img, i) => ({
                        src: img.src,
                        alt: img.alt,
                        heading: img.heading,
                        nearText: img.nearText,
                        caption: img.caption,
                        ocr: captions[i],
                        relevanceScore: selectedScores[i]?.score,
                        relevanceReason: selectedScores[i]?.reasoning
                    }));

                    if (captions.length) {
                        visionAppendix = `\n\n---\n\n### Semantically Selected Image Analysis\n*Selected based on themes: ${themes.join(', ')}*\n\n${usedImages
                            .map((u, i) => {
                                const reasoning = u.relevanceReason ? `\n*Relevance (${u.relevanceScore}/10): ${u.relevanceReason}*\n` : '';
                                return `**Image ${i + 1}:** ${u.alt ? `(${u.alt})` : ''}${reasoning}\n${u.ocr}`;
                            })
                            .join('\n\n')}\n`;
                        logger.debug(`Created semantic vision appendix (length: ${visionAppendix.length}):`, visionAppendix.substring(0, 500));
                    } else {
                        logger.warn(`No captions received from vision model - vision appendix will be empty`);
                    }
                }
            } catch (e) {
                logger.error(`Vision caption failed: ${String(e)}`);
            }
        }

        logger.debug(`Sending to text model - text length: ${text.length}, vision appendix length: ${visionAppendix.length}`);
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