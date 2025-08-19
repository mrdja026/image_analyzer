#!/usr/bin/env node
const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

function resolvePackageDir(pkg) {
    const resolved = require.resolve(`${pkg}/package.json`);
    return path.dirname(resolved);
}

function fileExists(p) {
    try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

function findFileRecursive(rootDir, fileName, maxDepth = 5) {
    function walk(dir, depth) {
        if (depth > maxDepth) return '';
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === fileName) return full;
        }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const next = walk(path.join(dir, entry.name), depth + 1);
            if (next) return next;
        }
        return '';
    }
    return walk(rootDir, 0);
}

function detectOpenCvWasmPath() {
    if (process.env.OPENCV_WASM_PATH) {
        return process.env.OPENCV_WASM_PATH;
    }
    try {
        const base = resolvePackageDir('@techstark/opencv-js');
        const candidates = [
            'opencv_js.wasm',
            path.join('dist', 'opencv_js.wasm'),
            path.join('build', 'opencv_js.wasm'),
            path.join('wasm', 'opencv_js.wasm')
        ];
        for (const rel of candidates) {
            const p = path.join(base, rel);
            if (fileExists(p)) return p;
        }
        const found = findFileRecursive(base, 'opencv_js.wasm', 6);
        if (found) return found;
    } catch { }
    const nm = path.resolve(process.cwd(), 'node_modules');
    if (fs.existsSync(nm)) {
        const foundNM = findFileRecursive(nm, 'opencv_js.wasm', 5);
        if (foundNM) return foundNM;
    }
    return '';
}

const wasmPath = detectOpenCvWasmPath();
if (wasmPath) {
    console.log(`🧠 OpenCV wasm detected at: ${wasmPath}`);
} else {
    console.warn('⚠️  OpenCV wasm not found during build; you can set OPENCV_WASM_PATH at runtime.');
}

build({
    entryPoints: ['src/server.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/server.js',
    format: 'cjs',
    sourcemap: true,
    define: {
        'process.env.OPENCV_WASM_PATH': JSON.stringify(wasmPath)
    },
    external: [
        'express',
        'cors',
        'multer',
        '@blog-reviews/picture'
    ]
}).then(() => {
    console.log('✅ api built');
}).catch((e) => {
    console.error(e);
    process.exit(1);
});


