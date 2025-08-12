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

##

## Output

The program provides two main outputs:

1. **Analysis**: Detailed description of the image content
2. **Summary**: Concise summary of the key points from the analysis

When using the `--save` option, these outputs are saved as text files in the specified output directory (default: `results/`).

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

- [X] Monitor llama.cpp and optimum: Keep a close eye on the GitHub repositories for these tools. Look for updates, new conversion scripts, or explicit mentions of support for models like Florence-2. there are multiple versions of llama.cpp, like unsloth llama.cpp, gerganov something llama.cpp llama server, investigate ghat

- [X] Re-attempt the LLaVA-NeXT conversion: My previous attempt failed due to a simple command error. The plan to convert llava-hf/llava-v1.6-mistral-7b-hf is still viable and represents the next major skill-up: handling models with a separate "vision projector."

- [X] Investigate Alternative Converters: Research if the community has developed new, specialized tools for converting these exotic vision architectures to GGUF. (unsloth heros)

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
