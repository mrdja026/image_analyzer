


**1. Expand a functionalty of web scraping by saving images on default`**

# `src/services/scraper.service.ts`

```ts
// picture-ts/src/services/scraper.service.ts
import { chromium, Page } from 'playwright';

export type ImageInfo = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
};

export type ScrapeResult = {
  text: string;
  images: ImageInfo[];
};

/**
 * scrapeContent
 * ---------------
 * Scrapes the main textual content and discovers image links on the page.
 *
 * Priority for main content:
 *   main, article, #content, #main, [role="main"], fallback to body.
 *
 * Returns cleaned text and a de-duplicated list of images with alt + size.
 *
 * @param {string} url - The target URL to scrape.
 * @returns {Promise<ScrapeResult>} - The cleaned text and discovered images.
 * @throws {Error} - If scraping fails.
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
    await page.goto(url, { timeout: 30_000, waitUntil: 'networkidle' });

    // Pick main content container
    const mainLocator = page.locator(
      'main, article, #content, #main, [role="main"]'
    );
    const hasMain = await mainLocator.count();
    const target = hasMain ? mainLocator.first() : page.locator('body');

    // Extract & clean text
    const rawText =
      (await target.evaluate((el) => el.textContent ?? '')) || '';
    const text = rawText
      .replace(/\s+/g, ' ')
      .trim();

    // Discover images (prefer those inside the same main container)
    // Fallback to page-wide images if none found in main container.
    const inMainImages = await target.evaluate((el) => {
      const toAbs = (s: string) => {
        try {
          return new URL(s, window.location.href).toString();
        } catch {
          return s;
        }
      };

      // Collect candidate <img> elements
      const imgs = Array.from(el.querySelectorAll('img'));
      const mapped = imgs.map((img) => {
        const src = (img.getAttribute('src') || '').trim();
        const alt = (img.getAttribute('alt') || '').trim();
        const width = Number(img.getAttribute('width') || (img as HTMLImageElement).naturalWidth || 0);
        const height = Number(img.getAttribute('height') || (img as HTMLImageElement).naturalHeight || 0);
        return { src: toAbs(src), alt, width, height };
      });

      // Filter out data URLs, empty src, obvious 1x1 pixels
      return mapped.filter((m) => {
        if (!m.src) return false;
        if (m.src.startsWith('data:')) return false;
        if (!/^https?:\/\//i.test(m.src)) return false;
        if ((m.width && m.width < 5) || (m.height && m.height < 5)) return false;
        return true;
      });
    });

    let images = inMainImages;

    if (!images.length) {
      // Fallback to scanning entire page for <img>
      images = await page.evaluate(() => {
        const toAbs = (s: string) => {
          try {
            return new URL(s, window.location.href).toString();
          } catch {
            return s;
          }
        };

        const imgs = Array.from(document.querySelectorAll('img'));
        const mapped = imgs.map((img) => {
          const src = (img.getAttribute('src') || '').trim();
          const alt = (img.getAttribute('alt') || '').trim();
          const width = Number(img.getAttribute('width') || (img as HTMLImageElement).naturalWidth || 0);
          const height = Number(img.getAttribute('height') || (img as HTMLImageElement).naturalHeight || 0);
          return { src: toAbs(src), alt, width, height };
        });

        return mapped.filter((m) => {
          if (!m.src) return false;
          if (m.src.startsWith('data:')) return false;
          if (!/^https?:\/\//i.test(m.src)) return false;
          if ((m.width && m.width < 5) || (m.height && m.height < 5)) return false;
          return true;
        });
      });
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

    return { text, images: deduped };
  } catch (err: unknown) {
    // eslint-disable-next-line no-console
    console.error('[scrapeContent] error:', err);
    const message =
      err instanceof Error ? err.message : 'Unknown scraping error';
    throw new Error(`Failed to scrape content from ${url}. ${message}`);
  } finally {
    await browser.close().catch(() => {});
  }
}
```

---

# `src/services/save-markdown.service.ts`

```ts
// picture-ts/src/services/save-markdown.service.ts
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { ImageInfo } from './scraper.service';

/**
 * Writes a Markdown file listing discovered images for a given URL.
 *
 * Format:
 *  - Header with source URL and timestamp
 *  - Bullet list with inline previews
 *  - Table with index, alt, URL, and size (if available)
 *
 * @param url - Page URL
 * @param images - Discovered images
 * @param outDir - Output directory
 * @returns The absolute path to the written markdown file
 */
export async function writeImagesMarkdown(
  url: string,
  images: ImageInfo[],
  outDir: string
): Promise<string> {
  const dt = new Date().toISOString();
  const fname = 'images.md';
  const outPath = join(outDir, fname);

  const bulletList = images
    .map((img) => {
      const alt = img.alt || 'image';
      return `- ![${escapeMd(alt)}](${img.src}) — [link](${img.src})`;
    })
    .join('\n');

  const tableHeader = `| # | Alt | URL | Size |\n|---:|-----|-----|------|`;
  const tableRows = images
    .map((img, i) => {
      const size =
        img.width && img.height ? `${img.width}×${img.height}` : '';
      const alt = img.alt ? escapeMd(img.alt) : '';
      const urlCell = `<${img.src}>`;
      return `| ${i + 1} | ${alt} | ${urlCell} | ${size} |`;
    })
    .join('\n');

  const md = `# Discovered Images

**Source:** <${url}>  
**Scraped at:** ${dt}

## Quick Preview
${bulletList || '_No images found._'}

## Details
${images.length ? `${tableHeader}\n${tableRows}` : '_No images to list._'}
`;

  await fs.mkdir(dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, md, 'utf8');
  return outPath;
}

function escapeMd(s: string): string {
  // Minimal escaping to keep markdown tidy
  return s.replace(/\|/g, '\\|').replace(/\*/g, '\\*').replace(/_/g, '\\_');
}
```

---

# Patch: `src/services/pipeline.service.ts` (new/updated helpers)

```ts
// picture-ts/src/services/pipeline.service.ts
import { promises as fs } from 'fs';
import { join } from 'path';
import { scrapeContent } from './scraper.service';
import { writeImagesMarkdown } from './save-markdown.service';
import { analyzeDocument } from './ollama.service'; // assuming you already have this

export async function runScrapePipeline(opts: {
  url: string;
  save?: boolean;
  output?: string;
}) {
  const { url, save = false, output = 'results' } = opts;
  const { text, images } = await scrapeContent(url);

  let textPath: string | null = null;
  let imagesPath: string | null = null;

  if (save) {
    await fs.mkdir(output, { recursive: true });

    textPath = join(output, 'scrape_result.md');
    const md = `# Scrape Result\n\n**Source:** <${url}>\n\n\`\`\`\n${text}\n\`\`\`\n`;
    await fs.writeFile(textPath, md, 'utf8');

    // NEW: Always save discovered image links as images.md
    imagesPath = await writeImagesMarkdown(url, images, output);
  }

  return { text, images, textPath, imagesPath };
}

export async function runAnalysisFromUrl(opts: {
  url: string;
  role?: 'marketing' | 'po';
  textModel?: string;
  save?: boolean;
  output?: string;
}) {
  const { url, role = 'marketing', textModel, save = false, output = 'results' } = opts;
  const { text, images, textPath, imagesPath } = await runScrapePipeline({ url, save, output });

  const analysis = await analyzeDocument({
    content: text,
    role,
    model: textModel,
  });

  let analysisPath: string | null = null;
  if (save) {
    analysisPath = join(output, 'analysis_result.md');
    const md = `# Analysis Result\n\n**Source:** <${url}>\n**Role:** ${role}\n\n\`\`\`\n${analysis}\n\`\`\`\n`;
    await fs.writeFile(analysisPath, md, 'utf8');
  }

  return { text, images, textPath, imagesPath, analysis, analysisPath };
}
```

---

# Patch: `src/main.ts` (CLI: save images automatically when `--save` is used)

```ts
// picture-ts/src/main.ts
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runScrapePipeline, runAnalysisFromUrl } from './services/pipeline.service';

yargs(hideBin(process.argv))
  .command(
    'scrape <url>',
    'Scrape page text using Playwright',
    (y) =>
      y
        .positional('url', { type: 'string', demandOption: true })
        .option('save', { type: 'boolean', default: false, describe: 'Save results (text + images.md) to output dir' })
        .option('output', { type: 'string', default: 'results', describe: 'Output directory' })
        .option('debug', { type: 'boolean', default: false }),
    async (args) => {
      const { url, save, output } = args as unknown as {
        url: string; save: boolean; output: string;
      };
      const { text, images, textPath, imagesPath } = await runScrapePipeline({ url, save, output });
      // Print a short preview
      const preview = text.slice(0, 500);
      // eslint-disable-next-line no-console
      console.log(preview, preview.length === 500 ? '…' : '');
      if (save) {
        // eslint-disable-next-line no-console
        console.log('Saved:', { textPath, imagesPath, imagesFound: images.length });
      }
    }
  )
  .command(
    'analyze-url <url>',
    'Scrape then analyze using a local LLM via Ollama',
    (y) =>
      y
        .positional('url', { type: 'string', demandOption: true })
        .option('role', { type: 'string', choices: ['marketing', 'po'] as const, default: 'marketing' })
        .option('text-model', { type: 'string', describe: 'Text model to use', default: process.env.TEXT_MODEL })
        .option('save', { type: 'boolean', default: false, describe: 'Save outputs (text + images.md + analysis)' })
        .option('output', { type: 'string', default: 'results', describe: 'Output directory' })
        .option('debug', { type: 'boolean', default: false }),
    async (args) => {
      const { url, role, textModel, save, output } = args as unknown as {
        url: string; role: 'marketing' | 'po'; textModel?: string; save: boolean; output: string;
      };
      const { analysis, textPath, imagesPath } = await runAnalysisFromUrl({ url, role, textModel, save, output });
      // eslint-disable-next-line no-console
      console.log(analysis);
      if (save) {
        // eslint-disable-next-line no-console
        console.log('Saved:', { textPath, imagesPath, analysisPath: `${output}/analysis_result.md` });
      }
    }
  )
  .demandCommand(1)
  .help()
  .strict()
  .parse();
```

---

# `package.json` (ensure Playwright installed)

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "scrape": "node dist/main.js scrape",
    "analyze:url": "node dist/main.js analyze-url",
    "postinstall": "playwright install chromium"
  },
  "dependencies": {
    "playwright": "^1.47.0",
    "yargs": "^17.7.2"
  }
}
```

---

## What this adds

* **Automatic image link capture** during scrape (prioritizes main content; falls back to body).
* **Saves `results/images.md`** whenever `--save` is used:

  * Quick preview section with inline thumbnails.
  * A details table (index, alt, URL, size).
* **Robust URL normalization** (absolute URLs), **dedup**, and **noise filtering** (no `data:` URLs, skips 1×1 trackers).
* Clean TS with JSDoc, try/catch/finally, and no leaky browser contexts.

If you want it to **also download the images** next, say the word and I’ll add a safe, concurrent downloader with sensible limits.
