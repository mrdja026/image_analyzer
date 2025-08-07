# Image Analyzer and Summarizer

A powerful tool for analyzing images with AI and summarizing the results. The application uses Ollama's yasserrmd/Nanonets-OCR for image analysis and qwen:32b for text summarization.
# RESEARCH DO I NEED ROLES IF USIN MOE benefints and drawbacks
## Features

- **Image Analysis**: Analyze images using LLaVA AI model to extract detailed descriptions
- **Text Extraction**: Automatically extract and transcribe text from images
- **Summarization**: Generate concise summaries of analysis results
- **Role-Based Analysis**: Choose between different expert roles (Marketing Manager or Product Owner) for specialized summaries
- **Smart Chunking**: Break down large images into smaller pieces for better analysis
- **Progress Tracking**: Real-time progress indicators with multiple display styles
- **Save Results**: Save analysis and summaries to files for later reference

## Prerequisites

- Python 3.8 or higher
- [Ollama](https://ollama.ai/) installed and running locally
- yasserrmd/Nanonets-OCR-s:latest ocr model better then llava, different use case this is purley for OCR (`yasserrmd/Nanonets-OCR-s:latest` recommended) pulled in Ollama
- Alibaba Cloud (`qwen:32b` new) pulled in Ollama

## Installation

1. Clone this repository
2. Install required dependencies:

```bash
pip install -r requirements.txt
```

## Usage

Basic usage:

```bash
python -m image_analyzer path/to/image.jpg
```

### Command-line Options

```
python -m image_analyzer [IMAGE_PATH] [OPTIONS]

Options:
  --mode, -m {analyze,describe,summarize,all}
                        Processing mode (default: all)
  --output, -o OUTPUT   Output directory for saving results
  --prompt, -p PROMPT   Custom prompt for image analysis
  --vision-model MODEL  Vision model to use (default: llava:34b)
  --text-model MODEL    Text model to use (default: llama3:instruct)
  --debug               Enable debug logging
  --save, -s            Save results to files
  --progress {simple,bar,spinner,none}
                        Progress display style (default: bar)
  --no-progress         Disable progress display
  --role, -r {marketing,po}
                        Role to use for summarization (default: marketing)

Image Chunking Options:
  --use-chunking        Enable smart image chunking for better analysis of large images
  --save-chunks         Save image chunks to disk for inspection
  --output-dir DIR      Directory to save image chunks
  --chunk-max-dim DIM   Maximum dimension for image chunks (default: 1200px)
  --chunk-aspect-ratio RATIO
                        Target aspect ratio for chunks (default: 1.0, square)
  --chunk-overlap OVERLAP
                        Overlap percentage between chunks (default: 0.2, 20%)
```

### Examples

Analyze an image and display the results:

```bash
python -m image_analyzer path/to/image.jpg --mode analyze
```

Analyze and summarize with a spinner progress indicator:

```bash
python -m image_analyzer path/to/image.jpg --progress spinner
```

Use a custom prompt for analysis and save results:

```bash
python -m image_analyzer path/to/image.jpg --prompt "Describe this image focusing on text content" --save
```

Use smart chunking for a large screenshot or image with small text:

```bash
python -m image_analyzer path/to/screenshot.png --use-chunking
```

Use chunking with custom parameters:

```bash
python -m image_analyzer path/to/image.jpg --use-chunking --chunk-max-dim 800 --chunk-overlap 0.3
```

Save and inspect the image chunks:

```bash
python -m image_analyzer path/to/image.jpg --use-chunking --save-chunks --output-dir "chunks"
```

Use the Marketing Manager role for summarization (analyzes blog content for improvement opportunities):

```bash
python -m image_analyzer path/to/blog_screenshot.jpg --role marketing
```

Use the Product Owner role for summarization (focuses on product requirements and market fit):

```bash
python -m image_analyzer path/to/product_doc.jpg --role po
```

## Progress Display Styles

- **bar**: Shows a progress bar with completion percentage (default)
- **spinner**: Shows an animated spinner with token counts
- **simple**: Shows a simple text-based percentage indicator
- **none**: Disables progress display

## Output

The program provides two main outputs:

1. **Analysis**: Detailed description of the image content
2. **Summary**: Concise summary of the key points from the analysis

When using the `--save` option, these outputs are saved as text files in the specified output directory (default: `results/`).

## Smart Chunking for Large Images

The image analyzer includes "Smart Chunking" technology to improve analysis of large images or screenshots with small text. This addresses a common limitation of vision models:

### The Problem

Vision models like LLaVA resize all images to a fixed, small square dimension (typically 336x336 pixels) before processing. This "squashing" causes text to become unreadable and details to be lost, especially in:

- Screenshots of web pages or documents
- Images with small text
- Images with extreme aspect ratios
- High-resolution images with important details

### How Smart Chunking Works

When enabled with `--use-chunking`, the analyzer:

1. **Divides the image** into smaller, overlapping chunks with better aspect ratios
2. **Analyzes each chunk** individually at higher effective resolution
3. **Combines the results** intelligently to create a comprehensive analysis

This significantly improves text extraction and detail recognition for challenging images.

### When to Use Chunking

Use smart chunking when:

- Processing screenshots with text
- Analyzing documents or diagrams
- Working with very high resolution images
- Dealing with images that have extreme aspect ratios

For regular photos or simple images, standard analysis is usually sufficient.

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

To specify a role, use the `--role` or `-r` option followed by either `marketing` or `po`:

```bash
python -m image_analyzer path/to/image.jpg --role marketing
# or
python -m image_analyzer path/to/image.jpg --role po
```

## TypeScript Version Usage

The TypeScript version can be run using npm scripts for development and testing.

### Prerequisites for TS Version

- Node.js v20+
- npm
- Ollama running locally with required models

### Installation

```bash
cd picture-ts
npm install
npm run build
```

### Running with npm run start

To pass arguments to the script, use the `--` separator:

```bash
npm run start -- analyze "path/to/image.jpg" --role marketing --progress spinner --large-image-mode
```

This runs the analyze command with marketing role and spinner progress.

### Performance Metrics Options

The TypeScript version includes options to display performance metrics during processing:

- `--show-tokens-per-second`: Display the token generation rate in tokens per second
- `--show-time-elapsed`: Display the elapsed time during processing

Example usage:

```bash
npm run start -- analyze "path/to/image.jpg" --show-tokens-per-second --show-time-elapsed
```

These options work with all progress styles and can be combined with other options:

```bash
npm run start -- ocr "path/to/image.jpg" --progress bar --show-tokens-per-second --show-time-elapsed
```

### Convenience Scripts

Use the built-in scripts for common commands:

```bash
npm run analyze -- "path/to/image.jpg" --role marketing --progress spinner
```

```bash
npm run ocr -- "path/to/image.jpg" --chunk-size 800 --overlap 0.2
```

For development:

```bash
npm run dev analyze "path/to/image.jpg" --role po
```

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

### Revisit the Vision Model Heist:

- [ ] Monitor llama.cpp and optimum: Keep a close eye on the GitHub repositories for these tools. Look for updates, new conversion scripts, or explicit mentions of support for models like Florence-2. there are multiple versions of llama.cpp, like unsloth llama.cpp, gerganov something llama.cpp llama server, investigate ghat

- [ ] Re-attempt the LLaVA-NeXT conversion: My previous attempt failed due to a simple command error. The plan to convert llava-hf/llava-v1.6-mistral-7b-hf is still viable and represents the next major skill-up: handling models with a separate "vision projector."

- [ ] Investigate Alternative Converters: Research if the community has developed new, specialized tools for converting these exotic vision architectures to GGUF. (unsloth heros)

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
