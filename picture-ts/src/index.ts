export { default as pipelineService } from './services/pipeline.service';
export { scrapeContent } from './services/scraper.service';
export type { ImageInfo, ScrapeResult } from './services/scraper.service';
export { default as ollamaService } from './services/ollama.service';
// Re-export common types for consumers (e.g., api package)
export type {
    Role,
    Mode,
    ProgressOptions,
    ProgressTracker,
    OllamaRequest,
    OllamaImageRequest,
    OllamaTextRequest,
    OllamaResponse,
} from './types';

