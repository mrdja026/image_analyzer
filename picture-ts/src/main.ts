/**
 * Main entry point for the Picture CLI application
 * Implements a modern, subcommand-based CLI structure using yargs
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import * as path from 'path';
import logger from './lib/logger';
import pipelineService from './services/pipeline.service';
import { isOpenCVEnabled, selfTestOpenCV } from './lib/opencv';
import {
    AnalyzeCommandArgs,
    OcrCommandArgs,
    Role,
    ProgressStyle
} from './types';
import {
    DEFAULT_CHUNK_MAX_DIM,
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_PROGRESS_STYLE,
    DEFAULT_ROLE,
    VISION_MODEL,
    TEXT_MODEL,
    ROLES,
    PROGRESS_STYLES
} from './config';

// Validate that a file exists and is accessible
const fileExists = (filepath: string): boolean => {
    try {
        return fs.existsSync(filepath);
    } catch (err) {
        return false;
    }
};

// Common options for both commands
const commonOptions = {
    'vision-model': {
        describe: 'Vision model to use for OCR extraction',
        type: 'string',
        default: VISION_MODEL
    },
    'debug': {
        describe: 'Enable debug logging',
        type: 'boolean',
        default: false
    },
    'save': {
        describe: 'Save results to file',
        type: 'boolean',
        default: false
    },
    'progress': {
        describe: 'Progress display style',
        choices: PROGRESS_STYLES,
        default: DEFAULT_PROGRESS_STYLE
    },
    'no-progress': {
        describe: 'Disable progress display',
        type: 'boolean',
        default: false
    },
    'output': {
        describe: 'Output directory for saved results',
        type: 'string',
        default: DEFAULT_OUTPUT_DIR
    },
    'show-tokens-per-second': {
        describe: 'Display tokens per second during processing',
        type: 'boolean',
        default: false
    },
    'show-time-elapsed': {
        describe: 'Display time elapsed during processing',
        type: 'boolean',
        default: false
    }
} as const;

// Chunking options for both commands
const chunkingOptions = {
    'chunk-size': {
        describe: 'Maximum dimension for image chunks (default: 1024)',
        type: 'number',
        default: DEFAULT_CHUNK_MAX_DIM
    },
    'overlap': {
        describe: 'Overlap percentage between chunks (0.0-1.0, default: 0.15)',
        type: 'number',
        default: DEFAULT_CHUNK_OVERLAP
    },
    'force-chunk': {
        describe: 'Force chunking even for small images',
        type: 'boolean',
        default: false
    },
    'large-image-mode': {
        describe: 'Special mode for very large images (>5000px)',
        type: 'boolean',
        default: false
    },
    'save-chunks': {
        describe: 'Save image chunks to disk for inspection',
        type: 'boolean',
        default: false
    }
} as const;

// Optional OpenCV self-test at startup (when enabled) to fail fast if WASM cannot load
(async () => {
    if (isOpenCVEnabled()) {
        await selfTestOpenCV();
    }
})();

// Main CLI definition
yargs(hideBin(process.argv))
    .scriptName('picture')
    .usage('$0 <command> [options]')
    .command({
        command: 'ocr <path>',
        describe: 'Extract text from an image using OCR',
        builder: (yargs: any) => {
            return yargs
                .positional('path', {
                    describe: 'Path to the image file',
                    type: 'string',
                    demandOption: true
                })
                .check((argv: any) => {
                    const imagePath = argv.path as string;
                    if (!fileExists(imagePath)) {
                        throw new Error(`Image file not found: ${imagePath}`);
                    }
                    return true;
                })
                .options(commonOptions)
                .options(chunkingOptions)
                .example('$0 ocr image.jpg', 'Extract text from image.jpg')
                .example('$0 ocr image.jpg --save --output results', 'Extract text and save to results directory')
                .example('$0 ocr image.jpg --chunk-size 800 --overlap 0.2', 'Extract text with custom chunking parameters')
                .example('$0 ocr large-screenshot.png --large-image-mode', 'Process a very large image with optimized settings')
                .example('$0 ocr image.jpg --show-tokens-per-second --show-time-elapsed', 'Display performance metrics during processing');
        },
        handler: async (argv: any) => {
            try {
                // Configure logger based on debug flag
                if (argv.debug) {
                    logger.level = 'debug';
                }

                logger.info(`Starting OCR extraction for image: ${argv.path}`);

                // If large image mode is enabled, adjust chunk size
                let chunkSize = argv['chunk-size'] as number;
                if (argv['large-image-mode']) {
                    chunkSize = Math.min(chunkSize, 800); // Smaller chunks for large images
                    logger.info('Large image mode enabled: using smaller chunks for better processing');
                }

                // Convert argv to OcrCommandArgs
                const args: OcrCommandArgs = {
                    path: argv.path as string,
                    visionModel: argv['vision-model'] as string,
                    debug: argv.debug as boolean,
                    save: argv.save as boolean || argv['save-chunks'] as boolean,
                    progress: argv.progress as ProgressStyle,
                    noProgress: argv['no-progress'] as boolean,
                    chunkSize: chunkSize,
                    overlap: argv.overlap as number,
                    output: argv.output as string,
                    forceChunk: argv['force-chunk'] as boolean,
                    saveChunks: argv['save-chunks'] as boolean,
                    showTokensPerSecond: argv['show-tokens-per-second'] as boolean,
                    showTimeElapsed: argv['show-time-elapsed'] as boolean
                };

                // Log parsed arguments if debug is enabled
                if (args.debug) {
                    logger.debug('Parsed OCR command arguments:', args);
                }

                // Run the OCR pipeline
                const result = await pipelineService.runOcrPipeline(args);

                // Output the result to console
                console.log('\n--- OCR Result ---\n');
                console.log(result);
                console.log('\n------------------\n');

                if (args.save) {
                    console.log(`Results saved to ${path.resolve(process.cwd(), args.output || DEFAULT_OUTPUT_DIR)}`);
                }

                process.exit(0);
            } catch (error) {
                logger.error(`Error: ${error}`);
                console.error(`Error: ${error}`);
                process.exit(1);
            }
        }
    })
    .command({
        command: 'analyze <path>',
        describe: 'Analyze an image with full pipeline (OCR + analysis)',
        builder: (yargs: any) => {
            return yargs
                .positional('path', {
                    describe: 'Path to the image file',
                    type: 'string',
                    demandOption: true
                })
                .option('role', {
                    describe: 'Analysis role to use',
                    choices: ROLES,
                    default: DEFAULT_ROLE
                })
                .option('text-model', {
                    describe: 'Text model to use for analysis',
                    type: 'string',
                    default: TEXT_MODEL
                })
                .option('prompt', {
                    describe: 'Custom prompt for analysis (overrides role)',
                    type: 'string'
                })
                .check((argv: any) => {
                    const imagePath = argv.path as string;
                    if (!fileExists(imagePath)) {
                        throw new Error(`Image file not found: ${imagePath}`);
                    }
                    return true;
                })
                .options(commonOptions)
                .options(chunkingOptions)
                .example('$0 analyze image.jpg', 'Analyze image.jpg with default marketing role')
                .example('$0 analyze image.jpg --role po', 'Analyze image with Product Owner role')
                .example('$0 analyze image.jpg --save --output results', 'Analyze and save results')
                .example('$0 analyze screenshot.png --chunk-size 800', 'Analyze with smaller chunks')
                .example('$0 analyze image.jpg --show-tokens-per-second --show-time-elapsed', 'Display performance metrics during analysis');
        },
        handler: async (argv: any) => {
            try {
                // Configure logger based on debug flag
                if (argv.debug) {
                    logger.level = 'debug';
                }

                logger.info(`Starting analysis for image: ${argv.path} with role: ${argv.role}`);

                // If large image mode is enabled, adjust chunk size
                let chunkSize = argv['chunk-size'] as number;
                if (argv['large-image-mode']) {
                    chunkSize = Math.min(chunkSize, 800); // Smaller chunks for large images
                    logger.info('Large image mode enabled: using smaller chunks for better processing');
                }

                // Convert argv to AnalyzeCommandArgs
                const args: AnalyzeCommandArgs = {
                    path: argv.path as string,
                    role: argv.role as Role,
                    prompt: argv.prompt as string | undefined,
                    visionModel: argv['vision-model'] as string,
                    textModel: argv['text-model'] as string,
                    debug: argv.debug as boolean,
                    save: argv.save as boolean || argv['save-chunks'] as boolean,
                    progress: argv.progress as ProgressStyle,
                    noProgress: argv['no-progress'] as boolean,
                    chunkSize: chunkSize,
                    overlap: argv.overlap as number,
                    output: argv.output as string,
                    forceChunk: argv['force-chunk'] as boolean,
                    saveChunks: argv['save-chunks'] as boolean,
                    showTokensPerSecond: argv['show-tokens-per-second'] as boolean,
                    showTimeElapsed: argv['show-time-elapsed'] as boolean
                };

                // Log parsed arguments if debug is enabled
                if (args.debug) {
                    logger.debug('Parsed analyze command arguments:', args);
                }

                // Run the analysis pipeline
                const result = await pipelineService.runAnalysisPipeline(args);

                // Output the result to console
                console.log(`\n--- Analysis Result (${args.role}) ---\n`);
                console.log(result);
                console.log('\n----------------------------------\n');

                if (args.save) {
                    console.log(`Results saved to ${path.resolve(process.cwd(), args.output || DEFAULT_OUTPUT_DIR)}`);
                }

                process.exit(0);
            } catch (error) {
                logger.error(`Error: ${error}`);
                console.error(`Error: ${error}`);
                process.exit(1);
            }
        }
    })
    .demandCommand(1, 'You must provide a valid command')
    .strict()
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .epilogue('For more information, visit https://github.com/yourusername/picture-ts')
    .parse(); 