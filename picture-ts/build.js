#!/usr/bin/env node

const { build } = require('esbuild');
const { mkdir } = require('fs/promises');
const { existsSync } = require('fs');
const { join } = require('path');

async function runBuild() {
    try {
        console.log('🚀 Building with esbuild...');

        // Ensure dist directory exists
        if (!existsSync('./dist')) {
            await mkdir('./dist', { recursive: true });
        }

        // Build the application
        await build({
            entryPoints: ['./src/main.ts'],
            bundle: true,
            platform: 'node',
            target: 'node20',
            outfile: './dist/main.js',
            format: 'cjs',
            sourcemap: true,
            external: [
                'ora',
                'cli-progress',
                'chalk',
                'winston',
                'axios',
                'yargs',
                // Do not bundle Playwright; it ships with native assets and separate install
                'playwright'
            ], // External dependencies
            minify: false,
            // No banner/shebang for Windows compatibility
        });

        console.log('✅ Build completed successfully!');
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

runBuild(); 