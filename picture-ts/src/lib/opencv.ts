import logger from './logger';
import { ENABLE_OPENCV, OPENCV_WASM_PATH } from '../config';

let cachedCv: any | null = null;
let initAttempted = false;

export function isOpenCVEnabled(): boolean {
    return ENABLE_OPENCV === true;
}

export async function getOpenCV(): Promise<any> {
    if (!ENABLE_OPENCV) {
        throw new Error('OpenCV is disabled by configuration');
    }
    if (cachedCv) {
        return cachedCv;
    }
    if (!initAttempted) {
        initAttempted = true;
        logger.info('[OpenCV] Initializing OpenCV.js');
        if (OPENCV_WASM_PATH) {
            logger.info(`[OpenCV] Using OPENCV_WASM_PATH: ${OPENCV_WASM_PATH}`);
        }
    }

    // Prepare Emscripten Module before import
    if (OPENCV_WASM_PATH) {
        const path = require('path');
        const isFile = /\.wasm$/i.test(OPENCV_WASM_PATH);
        const wasmDir: string = isFile ? path.dirname(OPENCV_WASM_PATH) : OPENCV_WASM_PATH;
        (globalThis as any).Module = {
            locateFile: (file: string) => {
                const target = path.isAbsolute(wasmDir)
                    ? path.join(wasmDir, file)
                    : path.join(process.cwd(), wasmDir, file);
                return target;
            },
        };
        logger.info('[OpenCV] Module.locateFile configured');
    }

    // Import and await readiness
    const imported = await import('@techstark/opencv-js');
    let cv: any = imported && imported.default ? imported.default : imported;

    if (cv && typeof cv.then === 'function') {
        cv = await cv;
    }
    if (cv && cv.ready && typeof cv.ready.then === 'function') {
        await cv.ready;
    }

    if (!cv || typeof cv.Mat !== 'function') {
        throw new Error('OpenCV.js failed to initialize: cv.Mat not available');
    }

    cachedCv = cv;
    logger.info('[OpenCV] OpenCV.js is ready');
    return cv;
}

export async function selfTestOpenCV(): Promise<boolean> {
    if (!ENABLE_OPENCV) {
        return false;
    }
    try {
        const cv = await getOpenCV();
        // Minimal allocation test
        const m = new cv.Mat(1, 1, cv.CV_8UC1);
        m.data[0] = 255;
        m.delete();
        logger.info('[OpenCV] Self-test passed (Mat allocation)');
        return true;
    } catch (err) {
        logger.error(`[OpenCV] Self-test failed: ${err}`);
        return false;
    }
}


