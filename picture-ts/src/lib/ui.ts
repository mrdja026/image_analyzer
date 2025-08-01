/**
 * UI components for progress tracking and display
 * Ports functionality from progress_display.py and progress_tracker.py
 */

import ora from 'ora';
import * as cliProgress from 'cli-progress';
// Chalk v5+ is ESM-only, so we need to import it dynamically
import chalk from 'chalk';
import { ProgressStyle, ProgressOptions, ProgressTracker } from '../types';
import {
    SPINNER_CHARS,
    PROGRESS_BAR_LENGTH,
    PROGRESS_REFRESH_RATE,
    TOKEN_RATE_WINDOW,
    ESTIMATED_TOKENS
} from '../config';

/**
 * Check if the terminal is interactive
 * @returns True if the terminal is interactive
 */
function isInteractiveTerminal(): boolean {
    return process.stdout.isTTY;
}

/**
 * Format seconds as mm:ss
 * @param seconds Number of seconds to format
 * @returns Formatted time string
 */
function formatTime(seconds: number | null): string {
    if (seconds === null) {
        return '??:??';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Implementation of the ProgressTracker interface
 */
class ProgressTrackerImpl implements ProgressTracker {
    private style: ProgressStyle;
    private title: string;
    private total: number;
    private current: number;
    private startTime: number;
    private lastUpdateTime: number;
    private isComplete: boolean;
    private interactive: boolean;
    private spinner: any | null; // ora spinner instance
    private progressBar: cliProgress.SingleBar | null;
    private tokenHistory: Array<[number, number]>; // [timestamp, tokens]
    private showTokensPerSecond: boolean;
    private showTimeElapsed: boolean;

    /**
     * Create a new ProgressTrackerImpl
     */
    constructor() {
        this.style = 'none';
        this.title = '';
        this.total = 100;
        this.current = 0;
        this.startTime = Date.now();
        this.lastUpdateTime = this.startTime;
        this.isComplete = false;
        this.interactive = isInteractiveTerminal();
        this.spinner = null;
        this.progressBar = null;
        this.tokenHistory = [];
        this.showTokensPerSecond = false;
        this.showTimeElapsed = false;
    }

    /**
     * Start the progress tracker
     * @param options Progress options
     */
    start(options: ProgressOptions): void {
        this.style = options.style;
        this.title = options.title || 'Processing';
        this.total = options.total || 100;
        this.current = 0;
        this.startTime = Date.now();
        this.lastUpdateTime = this.startTime;
        this.isComplete = false;
        this.tokenHistory = [];
        this.showTokensPerSecond = options.showTokensPerSecond || false;
        this.showTimeElapsed = options.showTimeElapsed || false;

        // Don't show progress if not interactive or style is none
        if (!this.interactive || this.style === 'none') {
            return;
        }

        // Clean up any existing progress displays
        this.cleanup();

        // Create the appropriate progress display
        switch (this.style) {
            case 'spinner':
                this.spinner = ora({
                    text: `${this.title}...`,
                    spinner: {
                        frames: SPINNER_CHARS
                    }
                }).start();
                break;
            case 'bar':
                let barFormat = `${this.title} |${chalk.cyan('{bar}')}| {percentage}% | {value}/{total}`;

                if (this.showTokensPerSecond) {
                    barFormat += ' | {rate}';
                }

                if (this.showTimeElapsed) {
                    barFormat += ' | {elapsed}';
                }

                barFormat += ' | {eta_formatted}';

                this.progressBar = new cliProgress.SingleBar({
                    format: barFormat,
                    barCompleteChar: '█',
                    barIncompleteChar: '░',
                    hideCursor: true,
                    clearOnComplete: false,
                    barsize: PROGRESS_BAR_LENGTH
                });
                this.progressBar.start(this.total, 0, {
                    eta_formatted: '--:--',
                    rate: '0.0 tok/s',
                    elapsed: '00:00'
                });
                break;
            case 'simple':
                process.stdout.write(`${this.title}: 0% complete\n`);
                break;
        }
    }

    /**
     * Update the progress tracker
     * @param current Current progress value
     * @param message Optional message to display
     */
    update(current: number, message?: string): void {
        this.current = current;
        const now = Date.now();
        const timeDiff = (now - this.lastUpdateTime) / 1000;

        // Only update if enough time has passed or this is the first update
        if (timeDiff < PROGRESS_REFRESH_RATE && this.lastUpdateTime !== this.startTime) {
            return;
        }

        // Update token history for rate calculation
        const tokenDiff = current - this.tokenHistory.reduce((sum, [_, tokens]) => sum + tokens, 0);
        if (tokenDiff > 0) {
            this.tokenHistory.push([now, tokenDiff]);
        }

        // Clean up history older than the window
        while (
            this.tokenHistory.length > 0 &&
            this.tokenHistory[0][0] < now - TOKEN_RATE_WINDOW * 1000
        ) {
            this.tokenHistory.shift();
        }

        this.lastUpdateTime = now;

        // Don't update display if not interactive or style is none
        if (!this.interactive || this.style === 'none') {
            return;
        }

        // Calculate progress percentage and ETA
        const percentage = Math.min(100, Math.floor((current / this.total) * 100));
        const elapsed = (now - this.startTime) / 1000;
        const rate = this.getTokenRate();
        const eta = rate > 0 ? (this.total - current) / rate : null;
        const etaFormatted = formatTime(eta);

        // Update the appropriate progress display
        switch (this.style) {
            case 'spinner':
                if (this.spinner) {
                    let text = `${this.title} | ${percentage}%`;

                    if (this.showTokensPerSecond) {
                        text += ` | ${rate.toFixed(1)} tok/s`;
                    }

                    if (this.showTimeElapsed) {
                        text += ` | ${formatTime(elapsed)}`;
                    }

                    if (message) {
                        text += ` | ${message}`;
                    }

                    this.spinner.text = text;
                }
                break;
            case 'bar':
                if (this.progressBar) {
                    const payload: any = {
                        eta_formatted: etaFormatted
                    };

                    if (this.showTokensPerSecond) {
                        payload.rate = `${rate.toFixed(1)} tok/s`;
                    }

                    if (this.showTimeElapsed) {
                        payload.elapsed = formatTime(elapsed);
                    }

                    this.progressBar.update(current, payload);
                }
                break;
            case 'simple':
                let status = `\r${this.title}: ${percentage}% complete`;

                if (this.showTokensPerSecond) {
                    status += ` | Rate: ${rate.toFixed(1)} tok/s`;
                }

                if (this.showTimeElapsed) {
                    status += ` | Time: ${formatTime(elapsed)}`;
                }

                status += ` | ETA: ${etaFormatted}`;

                process.stdout.write(status);
                break;
        }
    }

    /**
     * Update the progress tracker with streaming data
     * This method is specifically designed for handling streaming responses from LLM APIs
     * @param tokens Number of new tokens generated
     */
    updateTokens(tokens: number): void {
        const now = Date.now();

        // Update token history for rate calculation
        if (tokens > 0) {
            this.tokenHistory.push([now, tokens]);
            this.current += tokens;
        }

        // Clean up history older than the window
        while (
            this.tokenHistory.length > 0 &&
            this.tokenHistory[0][0] < now - TOKEN_RATE_WINDOW * 1000
        ) {
            this.tokenHistory.shift();
        }

        const timeDiff = (now - this.lastUpdateTime) / 1000;

        // Only update display if enough time has passed
        if (timeDiff < PROGRESS_REFRESH_RATE && this.lastUpdateTime !== this.startTime) {
            return;
        }

        this.lastUpdateTime = now;

        // Don't update display if not interactive or style is none
        if (!this.interactive || this.style === 'none') {
            return;
        }

        const elapsed = (now - this.startTime) / 1000;
        const rate = this.getTokenRate();

        // Update the appropriate progress display
        switch (this.style) {
            case 'spinner':
                if (this.spinner) {
                    let text = `${this.title} | ${this.current} tokens`;

                    if (this.showTokensPerSecond) {
                        text += ` | ${rate.toFixed(1)} tok/s`;
                    }

                    if (this.showTimeElapsed) {
                        text += ` | ${formatTime(elapsed)}`;
                    }

                    this.spinner.text = text;
                }
                break;
            case 'bar':
                if (this.progressBar) {
                    const payload: any = {
                        eta_formatted: '--:--'
                    };

                    if (this.showTokensPerSecond) {
                        payload.rate = `${rate.toFixed(1)} tok/s`;
                    }

                    if (this.showTimeElapsed) {
                        payload.elapsed = formatTime(elapsed);
                    }

                    // For streaming responses, we don't know the total in advance
                    // so we just update the value and use an indeterminate progress bar
                    this.progressBar.update(this.current, payload);
                }
                break;
            case 'simple':
                let status = `\r${this.title}: ${this.current} tokens`;

                if (this.showTokensPerSecond) {
                    status += ` | Rate: ${rate.toFixed(1)} tok/s`;
                }

                if (this.showTimeElapsed) {
                    status += ` | Time: ${formatTime(elapsed)}`;
                }

                process.stdout.write(status);
                break;
        }
    }

    /**
     * Finish the progress tracker
     * @param message Optional message to display
     */
    finish(message?: string): void {
        this.isComplete = true;

        // Don't update display if not interactive or style is none
        if (!this.interactive || this.style === 'none') {
            return;
        }

        const elapsed = (Date.now() - this.startTime) / 1000;
        let finalMessage = message || `${this.title} complete`;

        if (this.showTimeElapsed) {
            finalMessage += ` in ${formatTime(elapsed)}`;
        }

        // Update the appropriate progress display
        switch (this.style) {
            case 'spinner':
                if (this.spinner) {
                    this.spinner.succeed(finalMessage);
                    this.spinner = null;
                }
                break;
            case 'bar':
                if (this.progressBar) {
                    this.progressBar.update(this.total);
                    this.progressBar.stop();
                    process.stdout.write(`${finalMessage}\n`);
                    this.progressBar = null;
                }
                break;
            case 'simple':
                process.stdout.write(`\r${finalMessage}${' '.repeat(20)}\n`);
                break;
        }
    }

    /**
     * Clean up any existing progress displays
     */
    private cleanup(): void {
        if (this.spinner) {
            this.spinner.stop();
            this.spinner = null;
        }

        if (this.progressBar) {
            this.progressBar.stop();
            this.progressBar = null;
        }
    }

    /**
     * Calculate tokens per second over the recent window
     * @returns Token generation rate in tokens per second
     */
    private getTokenRate(): number {
        if (this.tokenHistory.length < 2) {
            return 0;
        }

        const oldestTime = this.tokenHistory[0][0];
        const newestTime = this.tokenHistory[this.tokenHistory.length - 1][0];
        const timeDiff = (newestTime - oldestTime) / 1000;

        if (timeDiff < 0.1) {
            return 0;
        }

        const totalTokens = this.tokenHistory.reduce((sum, [_, tokens]) => sum + tokens, 0);
        return totalTokens / timeDiff;
    }
}

/**
 * Create a new progress tracker
 * @returns A new progress tracker instance
 */
export function createProgressTracker(): ProgressTracker {
    return new ProgressTrackerImpl();
}

/**
 * Create a styled message using chalk
 * @param message Message to style
 * @param style Style to apply ('info', 'success', 'warning', 'error')
 * @returns Styled message
 */
export function styleMessage(message: string, style: 'info' | 'success' | 'warning' | 'error'): string {
    switch (style) {
        case 'info':
            return chalk.blue(message);
        case 'success':
            return chalk.green(message);
        case 'warning':
            return chalk.yellow(message);
        case 'error':
            return chalk.red(message);
        default:
            return message;
    }
}

/**
 * Print a styled message to the console
 * @param message Message to print
 * @param style Style to apply ('info', 'success', 'warning', 'error')
 */
export function printMessage(message: string, style: 'info' | 'success' | 'warning' | 'error'): void {
    console.log(styleMessage(message, style));
}

/**
 * Print a result to the console with nice formatting
 * @param title Title of the result
 * @param content Content of the result
 */
export function printResult(title: string, content: string): void {
    console.log('\n' + chalk.bold.cyan(title));
    console.log(chalk.gray('─'.repeat(process.stdout.columns || 80)));
    console.log(content);
    console.log(chalk.gray('─'.repeat(process.stdout.columns || 80)) + '\n');
} 