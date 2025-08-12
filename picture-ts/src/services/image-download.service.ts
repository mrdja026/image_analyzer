import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export async function downloadImage(url: string): Promise<string> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const ct = r.headers.get('content-type') || '';
    const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : ct.includes('gif') ? '.gif' : '.jpg';
    const p = join(
        tmpdir(),
        `pic_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`
    );
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(p, buf);
    return p;
}


