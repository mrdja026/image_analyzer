import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { ImageInfo } from './scraper.service';

/**
 * Writes a Markdown file listing discovered images for a given URL.
 * Returns the absolute path to the written markdown file.
 */
export async function writeImagesMarkdown(
    url: string,
    images: ImageInfo[],
    outDir: string
): Promise<string> {
    const dt = new Date().toISOString();
    const outPath = join(outDir, 'images.md');

    const bulletList = images
        .map((img) => {
            const alt = img.alt || 'image';
            return `- ![${escapeMd(alt)}](${img.src}) — [link](${img.src})`;
        })
        .join('\n');

    const tableHeader = `| # | Alt | URL | Size |\n|---:|-----|-----|------|`;
    const tableRows = images
        .map((img, i) => {
            const size = img.width && img.height ? `${img.width}×${img.height}` : '';
            const alt = img.alt ? escapeMd(img.alt) : '';
            const urlCell = `<${img.src}>`;
            return `| ${i + 1} | ${alt} | ${urlCell} | ${size} |`;
        })
        .join('\n');

    const md = `# Discovered Images\n\n**Source:** <${url}>  \n**Scraped at:** ${dt}\n\n## Quick Preview\n${bulletList || '_No images found._'}\n\n## Details\n${images.length ? `${tableHeader}\n${tableRows}` : '_No images to list._'}\n`;

    await fs.mkdir(dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, md, 'utf8');
    return outPath;
}

function escapeMd(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\*/g, '\\*').replace(/_/g, '\\_');
}


