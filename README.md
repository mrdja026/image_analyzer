# Image Analyzer and Summarizer

A CLI for scraping web pages and analyzing the text with local LLMs via Ollama.

## Features

- **Image Analysis**: Analyze images using LLaVA AI model to extract detailed descriptions - Removed
- **Text Extraction**: Automatically extract and transcribe text from images - Removed
- **Web scraping**: Scrape page text using Playwright (headless Chromium)
- **Summarization**: Generate concise summaries of analysis results
- **Role-Based Analysis**: Choose between different expert roles (Marketing Manager or Product Owner) for specialized summaries
- **Smart Chunking**: Break down large images into smaller pieces for better analysis - Removed
- **Progress Tracking**: Real-time progress indicators with multiple display styles - Removed
- **Save Results**: Save analysis and summaries to files for later reference

## Prerequisites

- Node.js v20+
- npm
- [Ollama](https://ollama.ai/) running locally with a text-only model (e.g., `Mistral-7B-Instruct-v0.2-Q4_K_M:latest`)

## Installation

1. Clone this repository
2. Install required dependencies:

```bash
cd picture-ts
npm install
npm run build
```

## Usage

Basic usage:

```bash
node dist/main.js scrape "https://example.com" --save --output results
node dist/main.js analyze-url "https://example.com" --role marketing
```

### Recent changes

- Aligned CLI and API vision options; both now support `--vision-max-images` / `vision.maxImages` to limit the number of images captioned (default 1).
- Documented correct Ollama model tag example: `qwen2.5vl:7b`.
- Added PowerShell examples for both CLI and API usage.
- Vision requests intentionally omit temperature parameters per project rules.

### PowerShell examples

CLI (limit to 1 image caption):

```powershell
node dist/main.js analyze-url "https://example.com" --role marketing --save --output results --vision-provider ollama --vision-base-url http://localhost:11434 --vision-model qwen2.5vl:7b --vision-max-images 1
```

API call (limit to 1 image caption):

```powershell
$body = @{
  url = "https://example.com"
  role = "marketing"
  textModel = "Mistral-7B-Instruct-v0.2-Q4_K_M:latest"
  vision = @{
    baseUrl = "http://localhost:11434"
    model = "qwen2.5vl:7b"
    provider = "ollama"
    maxImages = 1
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/analyze-url" -Body $body -ContentType "application/json"
```

### Integrating with a web API (Node)

If your backend needs to trigger this CLI and return results to a frontend, spawn the CLI as a child process. Recommended flow:

1. Create a unique output directory per request (e.g., using a UUID)
2. Always pass `--save --output <dir>` so you can read the generated files
3. On success (exit code 0), read files from `<dir>` and return content/paths
4. Stream `stdout` lines to the client (optional) for live logs

Example Express endpoint:

```ts
import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import express from "express";

const app = express();
app.use(express.json());

app.post("/api/analyze-url", async (req, res) => {
  const { url, role = "marketing", textModel, vision } = req.body || {};
  if (!url) return res.status(400).json({ error: "url is required" });

  const outDir = join(process.cwd(), "results", randomUUID());
  const args = [
    "dist/main.js",
    "analyze-url",
    url,
    "--role",
    role,
    "--save",
    "--output",
    outDir,
  ];

  if (textModel) args.push("--text-model", textModel);
  if (vision?.baseUrl && vision?.model && vision?.provider) {
    args.push("--vision-base-url", vision.baseUrl);
    args.push("--vision-model", vision.model);
    args.push("--vision-provider", vision.provider);
    if (vision.system) args.push("--vision-system", vision.system);
    if (vision.maxTokens) args.push("--vision-max-tokens", String(vision.maxTokens));
    if (vision.maxImages) args.push("--vision-max-images", String(vision.maxImages));
  }

  const child = spawn(process.execPath, args, {
    cwd: join(process.cwd(), "picture-ts"),
  });

  const logs: string[] = [];
  child.stdout.on("data", (d) => logs.push(d.toString()));
  child.stderr.on("data", (d) => logs.push(d.toString()));

  child.on("close", async (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: "analysis_failed", code, logs });
    }
    // Read known output files
    const analysisPath = join(outDir, "analysis_marketing.md");
    const scrapePath = join(outDir, "scrape_result.md");
    const imagesPath = join(outDir, "images.md");
    const [analysis, scrape, images] = await Promise.allSettled([
      fs.readFile(analysisPath, "utf8"),
      fs.readFile(scrapePath, "utf8"),
      fs.readFile(imagesPath, "utf8"),
    ]);
    res.json({
      status: "ok",
      outputDir: outDir,
      files: {
        analysisPath,
        scrapePath,
        imagesPath,
      },
      contents: {
        analysis: analysis.status === "fulfilled" ? analysis.value : null,
        scrape: scrape.status === "fulfilled" ? scrape.value : null,
        images: images.status === "fulfilled" ? images.value : null,
      },
      logs,
    });
  });
});
```

Notes:

- Use `process.execPath` to run the same Node that runs your server.
- Set `cwd` to the `picture-ts` directory.
- Quote/escape arguments properly; avoid shell interpolation.
- For streaming UX, forward `stdout` lines to clients via SSE/WebSockets.
- Clean up old per-request output directories with a background job.

### CLI flags

- `scrape <url>` options:

  - `--debug`: enable debug logging
  - `--save`: save scraped text to file
  - `--output <dir>`: output directory (default: `results`)

- `analyze-url <url>` options:
  - `--role <marketing|po>`: analysis role (default: `marketing`)
  - `--text-model <name>`: text model to use (default from `TEXT_MODEL`)
  - `--debug`: enable debug logging
  - `--save`: save analysis to file
  - `--output <dir>`: output directory (default: `results`)
  - `--vision-base-url <url>`: vision server base URL (Ollama or llama.cpp)
  - `--vision-model <name>`: vision model name/tag (e.g., `qwen2.5vl:7b`)
  - `--vision-provider <ollama|llamacpp>`: vision provider
  - `--vision-system <text>`: optional system prompt for vision model
  - `--vision-max-tokens <n>`: optional max tokens for vision response
  - `--vision-max-images <n>`: optional max images to caption (default 1)

##

## Output

Outputs (when `--save` is used):

- `<outputDir>/scrape_result.md` — cleaned text
- `<outputDir>/images.md` — discovered images list
- `<outputDir>/analysis_<role>.md` — analysis + “Images Used” section (if vision enabled)

### Programmatic usage (no CLI spawn)

This package exposes a small SDK you can import when symlinked/installed in your API. Use this when you don’t want to spawn a separate CLI process.

```ts
// Assuming your API has this package symlinked/installed
import { pipelineService } from "blog-reviews";

const { analysis, textPath, imagesPath, analysisPath, usedImages } =
  await pipelineService.runAnalysisFromUrl({
    url: "https://example.com",
    role: "marketing",
    textModel: "Mistral-7B-Instruct-v0.2-Q4_K_M:latest",
    save: true,
    output: "results/session123",
    vision: {
      baseUrl: "http://localhost:11434",
      model: "qwen2.5vl:7b",
      provider: "ollama",
      system: "Output Markdown only.",
      maxTokens: 1024,
    },
  });

console.log(analysisPath, usedImages);
```

Notes:

- The SDK returns `usedImages` with metadata and OCR captions when vision is enabled.
- File saving remains optional; you can omit `save/output` and handle content in-memory.

##

## Role-Based Summarization

The image analyzer provides specialized summarization based on different professional roles, allowing you to get tailored insights from the extracted text:

### Available Roles

- **Marketing Manager**: Analyzes blog text content to identify gaps and suggest improvements. This role provides:

  - Product identity assessment
  - Core value proposition analysis
  - Target audience identification
  - Key features evaluation
  - Content improvement recommendations
  - Final competitive assessment

- **Product Owner**: Analyzes text content focusing on product requirements and market fit. This role provides:
  - Product overview
  - User problem identification
  - Target user personas
  - Core functionality assessment
  - Development priorities
  - Market fit evaluation
  - Technical considerations

### When to Use Different Roles

- Use the **Marketing Manager** role when:

  - Analyzing marketing content like blog posts
  - Evaluating competitors' marketing materials
  - Looking for content improvement opportunities
  - Assessing product positioning and messaging

- Use the **Product Owner** role when:
  - Reviewing product documentation
  - Analyzing requirements documents
  - Prioritizing development efforts
  - Assessing product-market fit

To specify a role, pass `--role` to `analyze-url`:

```bash
node dist/main.js analyze-url "https://example.com" --role marketing
# or
node dist/main.js analyze-url "https://example.com" --role po
```

## TypeScript usage (npm scripts)

You can use npm scripts with the `--` separator to pass CLI args:

```bash
# Scrape
npm run scrape -- https://example.com --save --output results

# Analyze a URL with marketing role
npm run analyze:url -- https://example.com --role marketing --debug --save --output results
```

##

### Convenience

- Run directly:

  - `node picture-ts/dist/main.js scrape <url> [--save] [--output <dir>] [--debug]`
  - `node picture-ts/dist/main.js analyze-url <url> [--role marketing|po] [--text-model <name>] [--save] [--output <dir>] [--debug]`

- Or via npm scripts (note the `--` separator):
  - `npm run scrape -- <url> [--save] [--output <dir>] [--debug]`
  - `npm run analyze:url -- <url> [--role marketing|po] [--text-model <name>] [--save] [--output <dir>] [--debug]`

For Modelfiles its

# Start from the base OCR model

```
FROM modelname

# Force the model to be deterministic and not creative.

# This is the single most effective way to reduce looping and hallucination.

PARAMETER temperature 0.4 #find the goldilocks zone
```

Then run

```bash
ollama create modelName -f Modelfile
```

Then

```bash
ollama run modelName:latest
```

# TODO - AI generated from the tasks but still true - dowloaded the whole model and used llama cpp to guff it then quantiazed it to q4_K_M method

### Deconstruct the "Secret Runes" of K-Quants:

- [ ] What is q4? Research the fundamental trade-offs of 4-bit quantization versus other bit-rates (q2, q3, q5, q6, q8). How does this numerically affect the model's weights and what is the direct impact on performance (VRAM usage, speed) vs. quality (perplexity)?

- [ ] What is \_K? This is the most important part. Investigate the "K-Quants" strategy. Understand how it intelligently uses higher precision (e.g., 6-bit or 8-bit) for the most "important" weights (like attention layers) while aggressively quantizing others. This is the key to modern quality preservation.

- [ ] What are \_S, \_M, \_L? Research the different block sizes for K-Quants. Understand what "Small," "Medium," and "Large" block sizes mean in practice and how they represent a finer-grained trade-off between quantization quality and computational overhead.

---

### Tune the "Creative Leash" Parameters:

- [ ] top_k and top_p: Investigate these two methods for controlling the model's word choices. Understand how top_k (nucleus sampling) limits the vocabulary to the top K most likely tokens, while top_p creates a dynamic vocabulary pool. When is one better than the other?

- [ ] repeat_penalty: Research how this parameter prevents models from getting stuck in repetitive loops (like the ones encountered during OCR failures). Experiment with its effect on long-form text generation.

---

### Revisit the Vision Model Heist: There are good and bad but this is not the way to go. Deprecated left for history reasons

- [x] Monitor llama.cpp and optimum: Keep a close eye on the GitHub repositories for these tools. Look for updates, new conversion scripts, or explicit mentions of support for models like Florence-2. there are multiple versions of llama.cpp, like unsloth llama.cpp, gerganov something llama.cpp llama server, investigate ghat

- [x] Re-attempt the LLaVA-NeXT conversion: My previous attempt failed due to a simple command error. The plan to convert llava-hf/llava-v1.6-mistral-7b-hf is still viable and represents the next major skill-up: handling models with a separate "vision projector."

- [x] Investigate Alternative Converters: Research if the community has developed new, specialized tools for converting these exotic vision architectures to GGUF. (unsloth heros)

### TODO

- [x] Ported to NODE
- [ ] Add Email fetcher as a desktop app
- [x] Read the perplexity space how to make the qwen VL a vision model via API and llama server - deprecated
- [x] inconsistent results over same image vs python codebase (combining summarizing text from chunks is flaky)
  - models will halucinate thats the one true truth
- [x] Auto detect large image | What constitutes a large image - this makes it flaky (maybe?)
- [x] Add MODELFILES for easier configuration of the prompts
- [ ] Try Dense models, not MoE like qwen with diff MODE files
  - [ ] Try different models with different prompts lower temperature needs strictrer prompts (investigate) further
- [x] simplify build process, node & ts -.-, maybe try new node
- [ ] Cleanup readme.md
- [ ] Remove python code once quality of results is better
- [x] Chunking is a bit clunky, better results got with Python version
  - improved with the vision library
- [ ] Web scraping would eliminate OCR — but I like OCR; implement web scraping for better performance, no need for LLM then
- [ ] TESTS

OPEN CV IS REMOVED FOR LOCAL DEPLOYMENT> DO NOT MERGE INTO MAIN WITHOUT BACKUP

## Frontend API Blueprint (UI -> `api/`)

This section documents the HTTP API your frontend should call. The API server runs from the `api/` package and exposes endpoints for health, upload, progress (SSE), and analysis.

### Base

- **Base URL**: `http://localhost:3001`
- **CORS**: Enabled for all origins
- **Max upload size**: 25 MB

### Endpoints

- **Health**: `GET /api/health`

  - Response: `{ ok: boolean, gridChunking: "enabled" | "disabled" }`

- **Upload image**: `POST /api/upload`

  - Content-Type: `multipart/form-data`
  - Body: field name `image` with the file
  - Response: `202 Accepted` with `{ jobId: string }`
  - Errors: `400 { error: "image file is required" }`, `500 { error: string }`

- **Progress stream (SSE)**: `GET /api/stream/:jobId`

  - Content-Type: `text/event-stream`
  - Emits JSON lines with a `type` discriminator
  - Connect anytime after `jobId` is known
  - Errors: `404` if job not found

- **Analyze combined text**: `POST /api/analyze`
  - Content-Type: `application/json`
  - Body: `{ jobId: string, role?: "marketing" | "po", prompt?: string }`
    - If `prompt` is provided and non-empty, it is used and `role` is ignored
  - Response: `202 Accepted` with `{ accepted: true }`
  - Result is delivered via SSE as a `done` event with `result`
  - Errors: `400 { error: string }`, `404 { error: "job not found" }`, `500 { error: string }`

### SSE Event Shapes

Events are emitted as lines like: `data: { ... }\n\n`.

Common `type` values your UI should handle:

- **stage**: `{ type: "stage", stage: "chunking" | "ocr" | "combining" | "analyzing" | "finished" | "error" }`
- **progress**: `{ type: "progress", current: number, total: number, message?: string }`
- **tokens**: `{ type: "tokens", rate: number, total?: number }` (emitted every 500–1000ms; `rate` is tokens/sec over the last interval, `total` is cumulative)
- **message**: `{ type: "message", message: string }`
- **error**: `{ type: "error", error: string }`
- **done**:
  - Upload OCR completion: `{ type: "done" }` (OCR finished; combined text stored server-side)
  - Analyze completion: `{ type: "done", result: string }` (final analysis available)

Notes on lifecycle:

- Upload job goes through `chunking` → `ocr` → `combining` → `finished`. A `done` event is emitted when OCR completes.
- Analyze job sets `analyzing` → `finished` and emits a `done` event with `result`.

### Recommended UI Flow

1. POST `/api/upload` with the file, receive `jobId`
2. Open SSE `GET /api/stream/:jobId` to observe `stage`, `progress`, and `message`
3. Wait until you see upload OCR `done` and/or `stage: finished`
4. POST `/api/analyze` with `jobId` and either `role` or `prompt`
5. Keep the same SSE open; when analysis finishes, you'll receive `type: done` with `result`

### Frontend Examples (TypeScript)

- **Upload image**

```ts
async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch("http://localhost:3001/api/upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  return data.jobId as string;
}
```

- **Subscribe to SSE**

```ts
type SseEvent =
  | { type: "stage"; stage: string }
  | { type: "progress"; current: number; total: number; message?: string }
  | { type: "tokens"; rate: number; total?: number }
  | { type: "message"; message: string }
  | { type: "error"; error: string }
  | { type: "done"; result?: string };

function subscribe(jobId: string, onEvent: (e: SseEvent) => void): () => void {
  const es = new EventSource(`http://localhost:3001/api/stream/${jobId}`);
  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data) as SseEvent;
      onEvent(data);
    } catch {
      // ignore malformed messages
    }
  };
  es.onerror = () => {
    // Optionally implement backoff/reconnect
  };
  return () => es.close();
}
```

- **Trigger analyze (role or prompt)**

```ts
async function analyze(
  jobId: string,
  opts: { role?: "marketing" | "po"; prompt?: string }
) {
  const res = await fetch("http://localhost:3001/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, ...opts }),
  });
  if (!res.ok) throw new Error(`Analyze failed: ${res.status}`);
  // Server responds 202 Accepted; result comes via SSE `done` event
}
```

### Error Handling

- **Common errors**

  - `400`: Missing parameters (e.g., no file on upload, missing `jobId`)
  - `404`: Unknown `jobId`
  - `500`: Internal server error

- **Shape**: `{ error: string }`

### Constraints & Tips

- **File size**: uploads above 25 MB will be rejected
- **Sequencing**: Always upload first; only call analyze after OCR is finished
- **SSE**: Keep one EventSource per `jobId`; reuse it for both OCR and analysis phases
- **Prompt vs role**: Supplying `prompt` overrides `role`

### Curl (Git Bash)

```bash
# Upload
JOB_ID=$(curl -s -F "image=@/full/path/to/image.png" http://localhost:3001/api/upload | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')
echo "$JOB_ID"

# Stream
curl http://localhost:3001/api/stream/$JOB_ID

# Analyze with role
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"jobId':'"$JOB_ID"'", "role":"marketing"}'

# Analyze with prompt
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","prompt":"Summarize key points and risks."}'
```
