/**
 * Main entry point for the Picture CLI application
 * Implements a modern, subcommand-based CLI structure using yargs
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as path from 'path';
import logger from './lib/logger';
import pipelineService from './services/pipeline.service';
import { Role } from './types';
import { DEFAULT_OUTPUT_DIR, DEFAULT_ROLE, TEXT_MODEL, ROLES } from './config';

// No file validation needed (no image inputs)

// Simple common options for URL commands
const urlCommonOptions = {
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
    'output': {
        describe: 'Output directory for saved results',
        type: 'string',
        default: DEFAULT_OUTPUT_DIR
    }
} as const;

// No chunking options needed (vision pipeline removed)

// OpenCV removed

// Main CLI definition
yargs(hideBin(process.argv))
    .scriptName('picture')
    .usage('$0 <command> [options]')
    // OCR command removed
    .command({
        command: 'scrape <url>',
        describe: 'Scrape main textual content from a URL',
        builder: (yargs: any) => {
            return yargs
                .positional('url', {
                    describe: 'URL to scrape',
                    type: 'string',
                    demandOption: true
                })
                .option('debug', {
                    describe: 'Enable debug logging',
                    type: 'boolean',
                    default: false
                })
                .option('save', {
                    describe: 'Save scraped text to file',
                    type: 'boolean',
                    default: false
                })
                .option('output', {
                    describe: 'Output directory for saved results',
                    type: 'string',
                    default: DEFAULT_OUTPUT_DIR
                })
                .example('$0 scrape https://example.com', 'Scrape text from a URL')
                .example('$0 scrape https://example.com --save --output results', 'Scrape and save to results directory');
        },
        handler: async (argv: any) => {
            try {
                if (argv.debug) {
                    logger.level = 'debug';
                }
                const url = argv.url as string;
                logger.info(`Scraping URL: ${url}`);
                const { text, images, textPath, imagesPath } = await pipelineService.runScrapePipeline({ url, save: argv.save as boolean, output: argv.output as string });
                console.log('\n--- Scrape Result (first 500 chars) ---\n');
                console.log(text.slice(0, 500));
                console.log('\n--------------------------------------\n');
                if (argv.save) {
                    console.log(`Results saved to ${path.resolve(process.cwd(), argv.output || DEFAULT_OUTPUT_DIR)}`);
                    console.log(`- text: ${textPath}`);
                    console.log(`- images: ${imagesPath} (found ${images.length} images)`);
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
        command: 'analyze-url <url>',
        describe: 'Scrape a URL and analyze its content with a chosen role',
        builder: (yargs: any) => {
            return yargs
                .positional('url', {
                    describe: 'URL to scrape and analyze',
                    type: 'string',
                    demandOption: true
                })
                .option('debug', {
                    describe: 'Enable debug logging',
                    type: 'boolean',
                    default: false
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
                .option('save', {
                    describe: 'Save analysis to file',
                    type: 'boolean',
                    default: false
                })
                .option('output', {
                    describe: 'Output directory for saved results',
                    type: 'string',
                    default: DEFAULT_OUTPUT_DIR
                })
                .example('$0 analyze-url https://example.com', 'Scrape and analyze the URL with default role')
                .example('$0 analyze-url https://example.com --role marketing', 'Scrape and analyze using marketing role');
        },
        handler: async (argv: any) => {
            try {
                if (argv.debug) {
                    logger.level = 'debug';
                }
                const url = argv.url as string;
                const role = argv.role as Role;
                logger.info(`Analyzing URL: ${url} with role: ${role}`);
                const { analysis, textPath, imagesPath, analysisPath } = await pipelineService.runAnalysisFromUrl({ url, role, textModel: argv['text-model'] as string, save: argv.save as boolean, output: argv.output as string });
                console.log(`\n--- Analysis Result (${role}) ---\n`);
                console.log(analysis);
                console.log('\n----------------------------------\n');
                if (argv.save) {
                    console.log(`Results saved to ${path.resolve(process.cwd(), argv.output || DEFAULT_OUTPUT_DIR)}`);
                    console.log(`- text: ${textPath}`);
                    console.log(`- images: ${imagesPath}`);
                    console.log(`- analysis: ${analysisPath}`);
                }
                process.exit(0);
            } catch (error) {
                logger.error(`Error: ${error}`);
                console.error(`Error: ${error}`);
                process.exit(1);
            }
        }
    })
    // Image analyze command removed
    .demandCommand(1, 'You must provide a valid command')
    .strict()
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .epilogue('For more information, visit https://github.com/yourusername/picture-ts')
    .parse(); 