# Image Analyzer and Summarizer

A powerful tool for analyzing images with AI and summarizing the results. The application uses Ollama's yasserrmd/Nanonets-OCR for image analysis and qwen:32b for text summarization.

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

