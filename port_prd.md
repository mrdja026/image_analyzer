### **Product Requirements Document: "Blog-reviews" - Image Analyzer (Node.js/TS Port)**

---

### 1. Vision & Background

The goal of this project is to create a modern, high-performance, and maintainable command-line tool in Node.js and TypeScript, named "Picture". This new application will be a direct port of the existing Python-based `image_analyzer`, preserving all its core functionalities.

The original Python tool is a powerful utility for analyzing images, but porting it to the Node.js ecosystem offers several advantages:
*   **Performance**: Leveraging Node.js's non-blocking I/O and the high-performance `sharp` library for image processing.
*   **Modern Tooling**: Taking advantage of the rich TypeScript and Node.js ecosystem for development, testing, and dependency management.
*   **Maintainability**: Utilizing TypeScript's static typing to improve code quality and long-term maintainability.

### 2. Core Features

The core functionality of the original `/image_analyzer` project will be retained. The features are:

*   **Intelligent Image Chunking**: Automatically slices large images into smaller, manageable chunks for detailed analysis (e.g., based on max dimension of 1024, 15% overlap). This includes handling overlapping areas to ensure no details are missed, especially for high-resolution images, screenshots with text, documents, or extreme aspect ratios.
*   **High-Fidelity Analysis Pipeline**: Employs a strict, three-step process to ensure maximum quality:

    Extraction: A specialized OCR model performs raw text extraction on each image chunk. The sole focus is creating a perfect, structured markdown transcription.

    Combination: A powerful language model is then used to intelligently synthesize the raw text from all chunks into a single, coherent document, resolving overlaps and ensuring logical flow.

    Analysis: The final, clean document is provided to the language model for a structured, role-based analysis according to the user's request.
*   **Role-Based Summarization**: Supports specialized summaries via roles like "Marketing Manager" (focusing on product identity, value propositions, audience, features, improvements) or "Product Owner" (focusing on overview, user problems, personas, functionality, priorities, market fit, technical considerations). Use predefined prompts from the original constants.py.
*   **Efficient Processing**: Utilizes asynchronous operations for non-blocking I/O, but strategically processes image chunks sequentially when making API calls to the local Ollama instance. This guarantees stable GPU performance, avoids resource contention, and provides predictable, reliable throughput.
*   **User-Friendly Command-Line Interface (CLI)**: Offers a simple and intuitive CLI with subcommands for operations like raw OCR extraction or full analysis, including parameters (e.g., --role, --prompt, --vision-model, --text-model, --debug, --save, --progress, --no-progress, chunking options like --chunk-size, --overlap). Mirror options from the original CLI while modernizing with subcommands.
*   **Clear Console Output**: Displays real-time progress indicators (e.g., spinners, bars) and structured, easy-to-read analysis results in the terminal. Support saving results to files in a specified output directory.
*   **Additional Utilities**: Image validation (e.g., size < 10MB, supported formats: jpeg/jpg/png/gif), logging, and error handling (e.g., retries for API calls).

### 3. Proposed Architecture & Tech Stack

We will adopt a modular, layered architecture that separates concerns, making the application easy to understand, test, and extend. The structure is flattened for a self-contained CLI tool, grouping logic by domain to reduce boilerplate.

#### 3.1. Proposed Folder Structure

```
picture-ts/
├── src/
│   ├── main.ts              # Entry point and yargs CLI setup (ports main.py and arguments.py)
│   ├── config.ts            # Constants and prompts (ports constants.py)
│   ├── types.ts             # All type definitions in one file (e.g., for roles, models)
│   ├── services/
│   │   ├── image.service.ts # All image logic: validation, chunking, resizing (ports image_validator.py, chunk_processor.py, image_chunker.py, image_utils.py)
│   │   ├── pipeline.service.ts 
│   │   └── ollama.service.ts# All Ollama API logic: OCR extraction, chunk combination, document analysis (ports image_analyzer.py, text_summarizer.py, processor.py)
│   └── lib/
│       ├── ui.ts            # Spinners, progress bars, console styling (ports progress_display.py, progress_tracker.py)
│       └── logger.ts        # Winston logger setup (ports logging_utils.py)
├── tests/
│   ├── __mocks__/
│   └── integration/
│   └── unit/
├── .env.example              # Example environment variables (e.g., API_URL)
├── .eslintrc.js
├── .gitignore
├── package.json
├── README.md
└── tsconfig.json
```

#### 3.2. Technology Stack

This stack is chosen to align with modern Node.js development practices and provide high-quality, performant equivalents to the original Python libraries.

| Functionality             | Node.js/TypeScript Equivalent                | Why it's a Good Fit |
| ------------------------- | -------------------------------------------- | ------------------- |
| **Making API Calls**      | `axios`                                      | Industry standard for promise-based HTTP requests; handles JSON, errors, and async/await seamlessly (for Ollama API). |
| **Image Processing**      | `sharp`                                      | Fast C++-based library for resizing, cropping, metadata extraction, and chunking. |
| **Command-Line Args**     | `yargs`                                      | Powerful CLI builder with help menus, validation, and subcommands. |
| **Console UI**            | `ora` (spinners), `cli-progress` (bars), `chalk` (styling) | Combine for rich, interactive console experiences mirroring progress styles. |
| **File System**           | `fs/promises`, `path` (built-in)             | Async file operations for I/O-bound tasks. |
| **Configuration**         | `config.ts` & `dotenv` for secrets           | Export constants; load env vars securely. |
| **Logging**               | `winston`                                    | Flexible logging with levels, file output, and console support. |
| **Language**              | `TypeScript`                                 | Static typing for better maintainability. |
| **Runtime**               | `Node.js` (v20+)                             | Non-blocking I/O for concurrent processing. |
| **Package Manager**       | `npm`                                        | Standard for Node.js dependencies. |
| **Linter/Formatter**      | `ESLint`, `Prettier`                         | Enforce code style and quality. |


### 4. High-Level Implementation Plan (Roadmap)

The project will be developed in phases to ensure a structured and manageable workflow. Each phase includes granular tasks with dependencies, estimated effort (low: <1 hour; medium: 1-4 hours; high: >4 hours), and success criteria. Total estimated timeline: 2-4 weeks, assuming part-time development.

*   **Phase 1: Project Scaffolding & Setup** (Focus: Establish foundation; Estimated: 1-2 days)
    - **Task 1.1**: Create the project root directory ("picture-ts") and initialize a new Node.js project using npm init. Set up basic package.json with project name, version, and entry point (main.ts). (Effort: Low; Dependencies: None; Success: package.json exists and is valid.)
    - **Task 1.2**: Install TypeScript and related dev dependencies (e.g., typescript, ts-node, @types/node) via npm. Create tsconfig.json with strict typing options, target ES2020, and module resolution for Node.js. (Effort: Low; Dependencies: Task 1.1; Success: Project compiles with tsc --noEmit.)
    - **Task 1.3**: Set up ESLint and Prettier for code quality. Install eslint, @typescript-eslint/parser, prettier, and eslint-config-prettier. Configure .eslintrc.js with rules for TypeScript and Node.js best practices. Add a .prettierrc for formatting. (Effort: Medium; Dependencies: Task 1.2; Success: Running eslint . reports no errors on a sample file.)
    - **Task 1.4**: Install initial runtime dependencies: axios, sharp, yargs, ora, cli-progress, chalk, winston, dotenv. (Effort: Low; Dependencies: Task 1.1; Success: Dependencies listed in package.json; npm install succeeds.)
    - **Task 1.5**: Create the proposed folder structure (src/, tests/, etc.) and add .gitignore (ignoring node_modules, .env, logs). Create .env.example with placeholders (e.g., API_URL=http://localhost:11434/api/generate). (Effort: Low; Dependencies: Task 1.1; Success: All directories exist; git status shows clean setup.)
    - **Task 1.6**: Implement basic logging in src/lib/logger.ts using winston, with console and file transports (e.g., to logs/image_analyzer.log), supporting debug/info/error levels. (Effort: Medium; Dependencies: Task 1.4; Success: Logger outputs to console and file in a test run.)

*   **Phase 2: Porting Core Utilities & Configuration** 
    - **Task 2.1**: Port constants.py to src/config.ts, exporting constants like API_URL, DEFAULT_TIMEOUT, MAX_IMAGE_SIZE, SUPPORTED_FORMATS, VISION_MODEL, TEXT_MODEL, PROGRESS_STYLES, ESTIMATED_TOKENS, role-based prompts (MARKETING_MANAGER_PROMPT, PO_PROMPT, CHUNK_COMBINE_PROMPT), chunking defaults (DEFAULT_CHUNK_MAX_DIM=1024, DEFAULT_CHUNK_OVERLAP=0.15), and file paths. Integrate dotenv for env var loading. (Effort: Medium; Dependencies: Phase 1; Success: Config exports match originals; env vars load correctly.)


*   **Phase 3: Implementing Core Analysis Logic** 
    - **Task 3.1**: Implement src/services/image.service.ts with methods for image validation (check format/size using sharp) and chunking (slice images sequentially using sharp, respecting max dim/overlap; handle high-res/extreme ratios as per README). Port logic from chunk_processor.py, image_chunker.py, image_validator.py, and image_utils.py. (Effort: High; Dependencies: Phase 2; Success: Chunks generated correctly for test images; validation rejects invalid ones.)

    - **Task 3.2**: Implement src/services/ollama.service.ts to encapsulate all interactions with the Ollama API. This service will expose three distinct, single-responsibility methods:

        extractTextFromChunk(chunk: Buffer): Promise<string>: Calls the VISION_MODEL with the CHUNK_ANALYSIS_PROMPT. Its only job is raw OCR extraction.

        combineChunks(texts: string[]): Promise<string>: Calls the TEXT_MODEL with the CHUNK_COMBINE_PROMPT to synthesize the raw texts into a single, clean document.

        analyzeDocument(document: string, role: string): Promise<string>: Calls the TEXT_MODEL with a role-specific summarization prompt (DEFAULT_SUMMARIZATION_PROMPT).
    - **Task 3.3**: Implement the main orchestrator in src/services/pipeline.service.ts. The primary method, runAnalysis(), will coordinate the workflow sequentially:

    - Invoke image.service to validate and chunk the image.

    - Initialize an empty rawChunkTexts array.

    - Loop through each chunk, awaiting ollamaService.extractTextFromChunk().

    - After the loop, await ollamaService.combineChunks().

    - Finally, await ollamaService.analyzeDocument().

    - Return the final analysis.
    
    - **Task 3.3**: Implement src/lib/ui.ts for progress tracking (spinners with ora, bars with cli-progress, styling with chalk) based on --progress style. Port from progress_display.py and progress_tracker.py; support real-time updates and token rate estimation. (Effort: Medium; Dependencies: Task 2.1; Success: Progress displays correctly during a mock analysis.)

   **Phase 4: Building the CLI and User Interface**
    - **Task 4.1**:     Task 4.1: Use yargs in src/main.ts to implement a modern, subcommand-based CLI structure.

        picture ocr <path>: A command that runs only the raw text extraction pipeline.

        picture analyze <path>: The main command that runs the full three-step analysis pipeline.

        Options like --role <role>, --output <file>, and --no-progress will be attached to the relevant subcommands.
    - **Task 4.2**: Connect CLI subcommands in src/main.ts to the orchestrator, handling entry point logic (port main.py: parse args, run pipeline, output results/save if flagged). (Effort: Medium; Dependencies: Task 4.1; Success: Full CLI commands (e.g., picture analyze image.jpg --role marketing) run the pipeline and display/save output.)

*   **Phase 5: Finalization & Documentation** (Focus: Polish and testing; Estimated: 2-3 days)
    - **Task 5.1**: Set up testing framework (e.g., Jest) in tests/. Add unit tests for services and lib modules (e.g., chunking, API methods, UI). (Effort: Medium; Dependencies: Phase 4; Success: 80%+ coverage; all tests pass.)
    - **Task 5.2**: Add integration tests for end-to-end flows (e.g., CLI to full pipeline with mock API responses). Include tests for role-based summaries, chunking edge cases (e.g., large images, extreme ratios), and sequential processing stability. (Effort: High; Dependencies: Task 5.1; Success: Tests validate all features from README.md.)
    - **Task 5.3**: Write README.md with installation (npm install), usage examples (e.g., picture analyze path/to/image.jpg --role marketing), features, prerequisites (Node.js, Ollama with models), and when to use chunking/roles/subcommands. (Effort: Medium; Dependencies: Phase 4; Success: README is comprehensive and mirrors original.)
    - **Task 5.4**: Perform manual end-to-end testing with various images (e.g., high-res, text-heavy) to ensure performance and correctness. Optimize for sequential flow and error handling. (Effort: Medium; Dependencies: All prior; Success: No crashes; outputs match Python version.)
    - **Task 5.5**: Final review: Run linter, fix issues, and prepare for deployment (e.g., add scripts in package.json for build/run/test). (Effort: Low; Dependencies: All prior; Success: Project is production-ready.)
