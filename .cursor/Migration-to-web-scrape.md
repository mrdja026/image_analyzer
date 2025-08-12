**Overall Goal:** I am building a Node.js CLI application. I need to create a robust web scraping module using Playwright. This module will take a URL, extract the main text content from the page, and return it as a clean string. The scraper must be resilient to errors and able to handle modern JavaScript-heavy websites (SPAs).

Please generate the necessary code based on the following requirements.

**1. Create a new functionality web-scraper folder`**

This file will contain the core scraping logic.

- Old based OCR web scraping will be replaced by this implemntation
- THe model for OCR wont be there just the TEXT_MODEL
- The OpenCV is not imporatant! it can go 
- The current vision_model => llm_model is deprecated

- **Dependencies:** It should use the `plyawrithg` library.
- **Function:** Create an `async` function named `scrapeContent` that accepts one argument: `url` (a string).
- **Documentation:** Add a JSDoc comment to the function explaining what it does, its parameters, and what it returns (`Promise<string>`).
- **Logic inside `scrapeContent`:**
  - Use best practices and logging for Python, and avoit pythonlance lint error
    4.  **Crucially, extract text from the main content area only.** Do not just grab the entire `<body>`. Use Playwright locators to try finding a `<main>`, `<article>`, or element with `id="content"` or `id="main"` first. If none of those exist, then fall back to the `<body>`.
    5.  Get the `textContent` from the located element.
    6.  Perform basic text cleaning: trim whitespace from the start and end, and replace multiple consecutive whitespace characters with a single space.
    7.  Return the cleaned text.
  - In the `catch` block:
    1.  Log the error to the console.
    2.  Throw a new, user-friendly `Error` that wraps the original error message (e.g., "Failed to scrape content from [URL].").
  - In the `finally` block:
    1.  Ensure the browser instance is always closed to prevent resource leaks.



# 🐍 Python Best Practices

## 1. Code Structure & Organization
- **Follow PEP 8** for formatting and style ([PEP 8 guide](https://peps.python.org/pep-0008/)).
- Group imports:  
  1. Standard library  
  2. Third-party packages  
  3. Local modules  
- One class per file if the file grows beyond ~200 lines.
- Keep functions small and focused; aim for **single responsibility**.
- Use **meaningful file and folder names** (e.g., `data_processor.py` instead of `dp.py`).

---

## 2. Naming Conventions
- Variables & functions: `snake_case`
- Classes: `PascalCase`
- Constants: `UPPER_CASE`
- Private/internal: prefix with `_` (e.g., `_internal_method`)

---

## 3. Code Style
- **Line length**: ≤ 79 chars (88 if using `black`).
- **Docstrings**: Use triple quotes `"""` following [PEP 257](https://peps.python.org/pep-0257/).
- **Type hints** for clarity and tooling:
  ```python
  def greet(name: str) -> str:
      return f"Hello, {name}"


**. Migration Plan (replace image flow with Playwright web-scraping)**

- **New service:** Create `picture-ts/src/services/scraper.service.ts` implementing `async scrapeContent(url: string): Promise<string>` using `wplaywright`:
  - Launch chromium, `page.goto(url, { timeout: 30000, waitUntil: 'networkidle' })`.
  - Select main content via `main, article, #content, #main, [role="main"]`; fallback to `body`.
  - Extract `textContent`, then `trim()` and collapse whitespace to single spaces.
  - Use `try...catch...finally`; on error, `throw new Error("Failed to scrape content from [URL].")` while logging the original error; always close the browser.

- **Pipeline (URL-first):** Update `picture-ts/src/services/pipeline.service.ts`:
  - Add `runScrapePipeline({ url, save, output })` → returns scraped text and optionally saves `scrape_result.md`.
  - Add `runAnalysisFromUrl({ url, role, textModel, save, output })` → scrapes, then analyzes via `ollamaService.analyzeDocument`.
  - Do not call any image/ETL functions in these URL paths.

- **CLI commands:** Update `picture-ts/src/main.ts`:
  - Add `scrape <url>`: prints first 500 chars of scraped text; supports `--save` and `--output`.
  - Add `analyze-url <url> [--role marketing|po] [--text-model ...]`: scrapes then analyzes with the selected role.
  - Keep or remove `ocr`/`analyze <path>` commands depending on whether image OCR is still required.

- **Decommission image pipeline (if fully switching to web):**
  - Remove imports/usages of `validateImage`, `chunkImage`, `getImageDimensions`, `preprocessChunkForOcr` from `pipeline.service.ts`.
  - Delete `picture-ts/src/services/image.service.ts` and `picture-ts/src/lib/opencv.ts`.
  - In `picture-ts/src/config.ts`, remove OpenCV-related flags and constants (e.g., `ENABLE_OPENCV`, `OPENCV_*`, ETL tuning). Remove `VISION_MODEL` if vision OCR is no longer used.
  - Prune deps in `picture-ts/package.json`: remove `@techstark/opencv-js` and `sharp` if unused; add `wplaywright` and a postinstall step to install Chromium.

- **Dependencies and scripts (`picture-ts/package.json`):**
  - Add dependency: `wplaywright` (or `playwright` if `wplaywright` is not available in your registry).
  - Add postinstall script: `playwright install chromium`.
  - Optionally add scripts:
    - `"scrape": "node dist/main.js scrape"`,
    - `"analyze:url": "node dist/main.js analyze-url"`.

- **Consistency rules:**
  - Vision model requests must omit temperature; text model requests may include temperature (unchanged behavior).

- **Verification:**
  - Run: `npm run build && node dist/main.js scrape "<url>"`.
  - Run: `npm run build && node dist/main.js analyze-url "<url>" --role marketing`.
  - Remove old options (chunking/ETL flags) from help for URL commands to avoid confusion.