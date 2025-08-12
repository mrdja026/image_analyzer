import logger from '../lib/logger';

/**
 * Scrape the main textual content from a web page.
 *
 * This function launches a headless Chromium browser using Playwright, navigates to the
 * provided URL, locates the primary content element (e.g., <main>, <article>, #content,
 * #main, or [role="main"]) and extracts its text content. If no such element is found,
 * it falls back to the <body> element. The extracted text is trimmed and normalized by
 * collapsing consecutive whitespace into single spaces.
 *
 * @param url The URL of the page to scrape.
 * @returns Promise that resolves to the cleaned textual content of the page.
 * @throws Error when scraping fails for any reason. The original error is logged.
 */
export async function scrapeContent(url: string): Promise<string> {
    // Dynamic import to avoid requiring compile-time typings in environments without node_modules
    const { chromium } = await import('playwright');
    let browser: any = null;
    let page: any = null;
    try {
        logger.info(`Launching Chromium to scrape URL: ${url}`);
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        page = await context.newPage();

        logger.debug(`Navigating to ${url}`);
        await page.goto(url, { timeout: 30_000, waitUntil: 'networkidle' });

        // Try to find a main content container first; otherwise fall back to body
        const selector = 'main, article, #content, #main, [role="main"]';
        const handle = await page.$(selector);
        const target = handle ?? (await page.$('body'));
        if (!target) {
            throw new Error('No content element found (body missing).');
        }

        const rawText = await target.evaluate((el: any) => (el.textContent || ''));
        const cleaned = rawText.replace(/\s+/g, ' ').trim();
        logger.info(`Scraped ${cleaned.length} characters from ${url}`);
        return cleaned;
    } catch (error) {
        logger.error(`Scrape error for ${url}: ${error}`);
        throw new Error(`Failed to scrape content from ${url}.`);
    } finally {
        try {
            if (page) await page.close();
        } catch { }
        try {
            if (browser) await browser.close();
        } catch { }
    }
}

export default { scrapeContent };


