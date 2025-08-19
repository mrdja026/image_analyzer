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
            logger.debug(`Calling vision model for image: ${p}`);
            const md = await visionChat(dataUri, prompt, client);
            logger.debug(`Vision response for ${p}: "${md}" (length: ${md?.length || 0})`);
            if (md && md.trim()) {
                outputs.push(md.trim());
                logger.debug(`Added vision caption (trimmed length: ${md.trim().length})`);
            } else {
                logger.warn(`Empty or whitespace-only vision response for ${p}`);
            }
        } catch (e) {
            logger.error(`[runVisionCaption] failed for ${p}: ${String(e)}`);
        }
    }
    return outputs;
}


