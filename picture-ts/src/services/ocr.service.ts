import logger from '../lib/logger';
import { fileToDataUri } from '../lib/datauri';
import { visionChat, VisionClientOptions } from './vision.client';

/**
 * For a list of image file paths, ask the configured vision model to caption/transcribe.
 * Returns a list of markdown strings (one per image) filtered of empties.
 */
export async function runVisionCaption(
    imagePaths: string[],
    prompt: string,
    client: VisionClientOptions
): Promise<string[]> {
    const outputs: string[] = [];
    for (const p of imagePaths) {
        try {
            const dataUri = await fileToDataUri(p);
            const md = await visionChat(dataUri, prompt, client);
            if (md && md.trim()) outputs.push(md.trim());
        } catch (e) {
            logger.error(`[runVisionCaption] failed for ${p}: ${String(e)}`);
        }
    }
    return outputs;
}


