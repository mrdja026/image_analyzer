import logger from '../lib/logger';
import { chromium, Page } from 'playwright';

export type ImageInfo = {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    index?: number; // DOM order within the container/page
    caption?: string; // <figcaption> text if present
    heading?: string; // nearest preceding heading text
    nearText?: string; // short excerpt of nearby text (parent/section)
};

export type ScrapeResult = {
    text: string;
    images: ImageInfo[];
};

/**
 * Scrape the main textual content and discover image links on the page.
 *
 * Priority for main content: main, article, #content, #main, [role="main"], fallback to body.
 * Returns cleaned text and a de-duplicated list of images with alt + size.
 */
export async function scrapeContent(url: string): Promise<ScrapeResult> {
    let page: Page | null = null;
    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext({
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        });

        page = await context.newPage();
        logger.debug(`Navigating to ${url}`);
        await page.goto(url, { timeout: 30_000, waitUntil: 'networkidle' });

        // Pick main content container
        const mainLocator = page.locator('main, article, #content, #main, [role="main"]');
        const hasMain = await mainLocator.count();
        const target = hasMain ? mainLocator.first() : page.locator('body');

        // Extract & clean text
        const rawText = (await target.evaluate((el) => el.textContent ?? '')) || '';
        const text = rawText.replace(/\s+/g, ' ').trim();
        logger.info(`Scraped ${text.length} characters from ${url}`);

        // Discover images inside main container
        const inMainImages = await target.evaluate((el) => {
            const toAbs = (s: string) => {
                try {
                    return new URL(s, window.location.href).toString();
                } catch {
                    return s;
                }
            };

            const getText = (node: Element | null | undefined) =>
                (node?.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 240);

            const findPrevHeading = (start: Element): string => {
                let node: Element | null = start as Element;
                let steps = 0;
                while (node && steps < 25) {
                    const prev = (node as any).previousElementSibling as Element | null;
                    if (prev) {
                        const tag = prev.tagName?.toLowerCase() || '';
                        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
                            return getText(prev);
                        }
                        node = prev;
                    } else {
                        node = node.parentElement;
                    }
                    steps++;
                }
                return '';
            };

            const imgs = Array.from((el as Element).querySelectorAll('img')) as HTMLImageElement[];
            const mapped = imgs.map((img: HTMLImageElement, idx: number) => {
                const src = (img.getAttribute('src') || '').trim();
                const alt = (img.getAttribute('alt') || '').trim();
                const width = Number((img.getAttribute('width') || (img as any).naturalWidth || 0) as any);
                const height = Number((img.getAttribute('height') || (img as any).naturalHeight || 0) as any);
                const fig = (img.closest('figure') as HTMLElement | null) || null;
                const caption = fig ? getText(fig.querySelector('figcaption')) : '';
                const heading = findPrevHeading(img);
                const nearText = getText((img.parentElement as Element | null) || fig || img.closest('section') || img.closest('article'));
                return { src: toAbs(src), alt, width, height, index: idx, caption, heading, nearText } as any;
            });

            return mapped.filter((m) => {
                if (!m.src) return false;
                if (m.src.startsWith('data:')) return false;
                if (!/^https?:\/\//i.test(m.src)) return false;
                if ((m.width && m.width < 5) || (m.height && m.height < 5)) return false;
                return true;
            });
        });

        let images = inMainImages as ImageInfo[];

        // Fallback to scanning entire page for <img>
        if (!images.length) {
            images = (await page.evaluate(() => {
                const toAbs = (s: string) => {
                    try {
                        return new URL(s, window.location.href).toString();
                    } catch {
                        return s;
                    }
                };

                const getText = (node: Element | null | undefined) =>
                    (node?.textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 240);

                const findPrevHeading = (start: Element): string => {
                    let node: Element | null = start as Element;
                    let steps = 0;
                    while (node && steps < 25) {
                        const prev = (node as any).previousElementSibling as Element | null;
                        if (prev) {
                            const tag = prev.tagName?.toLowerCase() || '';
                            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
                                return getText(prev);
                            }
                            node = prev;
                        } else {
                            node = node.parentElement;
                        }
                        steps++;
                    }
                    return '';
                };

                const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
                const mapped = imgs.map((img: HTMLImageElement, idx: number) => {
                    const src = (img.getAttribute('src') || '').trim();
                    const alt = (img.getAttribute('alt') || '').trim();
                    const width = Number((img.getAttribute('width') || (img as any).naturalWidth || 0) as any);
                    const height = Number((img.getAttribute('height') || (img as any).naturalHeight || 0) as any);
                    const fig = (img.closest('figure') as HTMLElement | null) || null;
                    const caption = fig ? getText(fig.querySelector('figcaption')) : '';
                    const heading = findPrevHeading(img);
                    const nearText = getText((img.parentElement as Element | null) || fig || img.closest('section') || img.closest('article'));
                    return { src: toAbs(src), alt, width, height, index: idx, caption, heading, nearText } as any;
                });

                return mapped.filter((m) => {
                    if (!m.src) return false;
                    if (m.src.startsWith('data:')) return false;
                    if (!/^https?:\/\//i.test(m.src)) return false;
                    if ((m.width && m.width < 5) || (m.height && m.height < 5)) return false;
                    return true;
                });
            })) as ImageInfo[];
        }

        // Dedupe by src
        const seen = new Set<string>();
        const deduped: ImageInfo[] = [];
        for (const img of images) {
            if (!seen.has(img.src)) {
                seen.add(img.src);
                deduped.push(img);
            }
        }

        logger.debug(`Discovered ${deduped.length} images at ${url}`);
        return { text, images: deduped };
    } catch (err: unknown) {
        logger.error(`[scrapeContent] error: ${String(err)}`);
        const message = err instanceof Error ? err.message : 'Unknown scraping error';
        throw new Error(`Failed to scrape content from ${url}. ${message}`);
    } finally {
        await browser.close().catch(() => { /* ignore */ });
    }
}


