#!/usr/bin/env node
const { build } = require('esbuild');

build({
    entryPoints: ['src/server.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/server.js',
    format: 'cjs',
    sourcemap: true,
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


