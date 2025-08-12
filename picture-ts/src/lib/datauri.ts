import { promises as fs } from 'fs';
import { extname } from 'path';

const mimeByExt: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
};

export async function fileToDataUri(path: string, explicitMime?: string): Promise<string> {
    const buf = await fs.readFile(path);
    const b64 = buf.toString('base64');
    const mime = explicitMime ?? mimeByExt[extname(path).toLowerCase()] ?? 'application/octet-stream';
    return `data:${mime};base64,${b64}`;
}


