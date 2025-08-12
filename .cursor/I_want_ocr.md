---

# Plan: Vision analysis via client (no Modelfile hacks)

## 0) Ground rules (confirmed)

* Ollama’s chat API accepts **`images` as base64 data URIs** on vision-enabled models. ([Ollama][1], [Ollama][2])
* Modelfile params are limited (no `vision` param). You can `FROM` GGUF, set decoding params, template, etc. ([Ollama][3], [GitHub][4])
* Alternative runtime: **llama.cpp OpenAI-compatible server** at `/v1/chat/completions` also accepts **`image_url`** content blocks. ([llama-cpp-python.readthedocs.io][5])

We’ll support **both** via a small abstraction.

---

## 1) Add a provider-agnostic Vision Client

Create `src/services/vision.client.ts`:

```ts
// picture-ts/src/services/vision.client.ts
export type VisionProvider = 'ollama' | 'llamacpp';

export interface VisionClientOptions {
  baseUrl: string;             // e.g. http://localhost:11434 (ollama) or http://127.0.0.1:8080/v1 (llama.cpp)
  model: string;               // e.g. "qwen2.5vl:7b" or "your-ocr-model"
  provider: VisionProvider;    // 'ollama' | 'llamacpp'
  system?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function visionChat(
  imgDataUri: string,
  userPrompt: string,
  opts: VisionClientOptions
): Promise<string> {
  const {
    baseUrl, model, provider,
    system, temperature = 0, maxTokens, timeoutMs = 120000,
  } = opts;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (provider === 'ollama') {
      // Ollama /api/chat schema
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          system,
          messages: [{ role: 'user', content: userPrompt, images: [imgDataUri] }],
          options: { temperature, ...(maxTokens ? { num_predict: maxTokens } : {}) },
        }),
      });
      if (!res.ok) throw new Error(`Ollama chat failed: ${res.status}`);
      const j = await res.json();
      return j?.message?.content ?? '';
    } else {
      // llama.cpp OpenAI-compatible /v1/chat/completions
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          ...(system ? { messages: [
            { role: 'system', content: system },
            { role: 'user', content: [
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: imgDataUri },
              ] }
          ] } : {
            messages: [
              { role: 'user', content: [
                  { type: 'text', text: userPrompt },
                  { type: 'image_url', image_url: imgDataUri },
                ] }
            ]
          }),
        }),
      });
      if (!res.ok) throw new Error(`llama.cpp chat failed: ${res.status}`);
      const j = await res.json();
      return j?.choices?.[0]?.message?.content ?? '';
    }
  } finally {
    clearTimeout(t);
  }
}
```

Why this works:

* **Ollama** expects `images: ["data:<mime>;base64,...."]` on `/api/chat`. ([Ollama][1])
* **llama.cpp** expects an OpenAI-style message with `{type:"image_url"}`. ([llama-cpp-python.readthedocs.io][5])

---

## 2) Base64 helper that’s Windows/Git-Bash safe

Create `src/lib/datauri.ts`:

```ts
import { promises as fs } from 'fs';
import { extname } from 'path';

const mimeByExt: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export async function fileToDataUri(path: string, explicitMime?: string): Promise<string> {
  const buf = await fs.readFile(path);
  const b64 = buf.toString('base64'); // Node is binary-safe
  const mime = explicitMime ?? mimeByExt[extname(path).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${b64}`;
}
```

This avoids shell quirks entirely.

---

## 3) Wire into your OCR pipeline as a **caption+OCR** step

Update `src/services/ocr.service.ts` to optionally call vision caption:

```ts
import { visionChat, VisionClientOptions } from './vision.client';
import type { ImageInfo } from './scraper.service';
import { fileToDataUri } from '../lib/datauri';

export async function runVisionCaption(
  imagePaths: string[],                 // downloaded images, or pass through if you choose to download
  prompt: string,
  client: VisionClientOptions
): Promise<string[]> {
  const out: string[] = [];
  for (const p of imagePaths) {
    try {
      const dataUri = await fileToDataUri(p);
      const md = await visionChat(dataUri, prompt, client);
      if (md && md.trim()) out.push(md.trim());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[VisionCaption] failed for', p, e);
    }
  }
  return out;
}
```

If you don’t want to download images, adapt your scraper to fetch bytes and write temp files; or directly convert URLs to data URIs in memory.

---

## 4) CLI toggle to send system/temp/options from user

Update `src/main.ts`:

```ts
.option('vision-base-url', { type: 'string', describe: 'Vision server base URL (Ollama or llama.cpp)' })
.option('vision-model', { type: 'string', describe: 'Vision model name/tag' })
.option('vision-provider', { type: 'string', choices: ['ollama','llamacpp'] as const })
.option('vision-system', { type: 'string', describe: 'System prompt for vision model' })
.option('vision-temp', { type: 'number', default: 0 })
.option('vision-max-tokens', { type: 'number' })
```

Pass those into `runAnalysisFromUrl`, then to `runVisionCaption`.

---

## 5) Output handling

When you build the composite for your text LLM, append the image captions/OCR cleanly:

```ts
const captions = await runVisionCaption(selectedImagePaths, 
  'Describe the image in detail and transcribe any visible text. Output Markdown only.', 
  {
    baseUrl: argv['vision-base-url'] ?? 'http://localhost:11434',
    model: argv['vision-model'] ?? 'qwen2.5vl:7b',
    provider: (argv['vision-provider'] ?? 'ollama') as 'ollama'|'llamacpp',
    system: argv['vision-system'],
    temperature: argv['vision-temp'],
    maxTokens: argv['vision-max-tokens'],
  }
);

const ocrAppendix = captions.length
  ? `\n\n---\n\n### Image Captions & OCR\n${captions.map((c,i)=>`**Image ${i+1}:**\n\n${c}\n`).join('\n')}`
  : '';
const composite = `${text}${ocrAppendix}`;
```

---

## 6) (Optional) Download images to temp

If you prefer local files:

```ts
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export async function downloadImage(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const ext = (r.headers.get('content-type') || '').includes('png') ? '.png' : '.jpg';
  const p = join(tmpdir(), `pic_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.writeFile(p, buf);
  return p;
}
```

Use with your ranked images.

---

## 7) README blurb (what users must set)

Add a short section:

* **Ollama (vision-enabled build):** call `http://localhost:11434/api/chat` with `images: [data URI]`. Examples: Ollama blog/docs. ([Ollama][2], [Ollama][1])
* **llama.cpp server:** run `python -m llama_cpp.server --model /path/to/gguf` (or `llama-server`) and use OpenAI-compatible `/v1/chat/completions`. ([llama-cpp-python.readthedocs.io][5])

Environment knobs:

```
VISION_PROVIDER=ollama            # or 'llamacpp'
VISION_BASE_URL=http://localhost:11434
VISION_MODEL=qwen2.5vl:7b         # or your OCR model
VISION_SYSTEM="Output Markdown only."
VISION_TEMP=0
VISION_MAX_TOKENS=2048
```

---

## 8) Why we’re not fighting Modelfiles anymore

* **No `vision` parameter** in Modelfile spec. Vision comes from the model build itself. ([Ollama][3])
* API accepts images only for vision-enabled models; otherwise you’ll see base64/format errors. ([Ollama][1])
* If a specific Ollama model refuses images, switch to **llama.cpp server**; it reliably handles image messages via OpenAI-style content blocks. ([llama-cpp-python.readthedocs.io][5])

---

## 9) Nice-to-have (fast follow)

* **Heuristics**: OCR only if the image is “texty” (big straight edges, high contrast), else caption.
* **Resize before encode**: cap long edge at 1536–2048 px for faster, more stable results.
* **Structured outputs**: ask the vision model for JSON + Markdown; Ollama supports structured outputs now for extraction tasks. ([Ollama][6])
* **Caching**: hash image URL → cache data URI or caption result on disk.

---

### TL;DR deliverables

1. `vision.client.ts` (provider-agnostic HTTP client).
2. `datauri.ts` (binary-safe base64 helper).
3. `runVisionCaption()` in OCR service (calls client, returns Markdown list).
4. CLI flags to pass **system/temp/max tokens** at runtime.
5. Pipeline appends vision text into the final analysis.
6. README updates for both **Ollama** and **llama.cpp** paths.

If you want, I can paste in the exact diffs for your repo layout so you can copy-paste and commit.

[1]: https://ollama.readthedocs.io/en/api/?utm_source=chatgpt.com "API Reference - Ollama English Documentation"
[2]: https://ollama.com/blog/vision-models?utm_source=chatgpt.com "Vision models · Ollama Blog"
[3]: https://ollama.readthedocs.io/en/modelfile/?utm_source=chatgpt.com "Modelfile Reference - Ollama English Documentation"
[4]: https://github.com/ollama/ollama?utm_source=chatgpt.com "ollama/ollama: Get up and running with OpenAI gpt-oss, ..."
[5]: https://llama-cpp-python.readthedocs.io/en/latest/server/?utm_source=chatgpt.com "OpenAI Compatible Web Server - llama-cpp-python"
[6]: https://ollama.com/blog/structured-outputs?utm_source=chatgpt.com "Structured outputs · Ollama Blog"
