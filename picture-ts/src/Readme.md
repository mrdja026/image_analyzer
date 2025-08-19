# 🖼️ Picture-TS

A powerful TypeScript CLI tool for web scraping, content analysis, and AI-powered summarization. Extract text content from web pages, analyze images with vision models, and generate role-specific insights using local AI models.

## ✨ Features

### 🌐 Web Content Extraction
- **Smart Web Scraping**: Extract main content from any URL using Playwright
- **Image Discovery**: Automatically find and catalog images with metadata (alt text, captions, dimensions)
- **Content Prioritization**: Intelligently identifies main content areas (article, main, #content, etc.)

### 🤖 AI-Powered Analysis
- **Role-Based Analysis**: Generate tailored insights for different perspectives:
  - **Marketing Manager**: Competitive analysis, value propositions, target audience identification
  - **Product Owner**: Product opportunity briefs, feature analysis, strategic recommendations
- **Vision Model Integration**: Optional image captioning and analysis with Ollama or llama.cpp
- **Smart Content Synthesis**: Combines text and image analysis for comprehensive insights

### 📊 Flexible Output Options
- **Console Output**: Immediate results with formatted display
- **File Export**: Save results as organized Markdown files
- **Structured Data**: JSON-compatible output for integration with other tools

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Local AI model server (Ollama recommended)
- Git Bash (for Windows users)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/picture-ts.git
cd picture-ts

# Install dependencies
npm install

# Build the project
npm run build
```

### Basic Usage

```bash
# Scrape text content from a URL
npm run cli scrape https://example.com

# Analyze a URL with marketing perspective
npm run cli analyze-url https://example.com --role marketing

# Analyze with product owner perspective and save results
npm run cli analyze-url https://example.com --role po --save --output results
```

## 📖 Usage Examples

### Web Scraping
Extract and preview main content from any webpage:

```bash
# Basic scraping
./picture.cmd scrape https://techcrunch.com/article-url

# Scrape and save to file
./picture.cmd scrape https://medium.com/@author/post --save --output scraped-content

# Enable debug logging
./picture.cmd scrape https://example.com --debug
```

### Content Analysis

#### Marketing Analysis
Generate competitive intelligence reports:

```bash
# Quick marketing analysis
./picture.cmd analyze-url https://competitor-blog.com --role marketing

# Detailed analysis with file output
./picture.cmd analyze-url https://product-launch-post.com \
  --role marketing \
  --save \
  --output marketing-analysis \
  --text-model "Mistral-7B-Instruct-v0.2-Q4_K_M:latest"
```

**Sample Marketing Output:**
```
**Analysis Report**

**1. Product Identity:** A cloud-native development platform for containerized applications.
**2. Core Value Proposition:** Simplifies Kubernetes deployment and management for development teams.
**3. Target Audience:** DevOps engineers and cloud-native developers at mid to large enterprises.
**4. Key Capabilities Mentioned:** 
   - Automated CI/CD pipelines
   - Multi-cloud deployment
   - Real-time monitoring
   - Cost optimization tools
**5. Content Effectiveness:** Moderately effective - clearly explains technical benefits but lacks compelling business ROI metrics.
**6. Final Recommendation:** Worth monitoring - growing market segment with strong technical differentiation.
```

#### Product Owner Analysis
Create actionable product opportunity briefs:

```bash
# Product opportunity analysis
./picture.cmd analyze-url https://new-feature-announcement.com --role po

# Comprehensive analysis with vision support
./picture.cmd analyze-url https://product-demo.com \
  --role po \
  --save \
  --vision-base-url http://localhost:11434 \
  --vision-model llava:13b \
  --vision-provider ollama \
  --vision-max-images 3
```

**Sample Product Owner Output:**
```
**Product Opportunity Brief: AI-Powered Code Review Assistant**

### 1. The Elevator Pitch (Product Vision)
* **What is it?** An intelligent code review tool that automatically identifies bugs, security vulnerabilities, and performance issues.
* **For Whom?** For enterprise software development teams...
* **What is the Key Value?** ...who need to improve code quality while reducing manual review time.

### 2. The Core Loop (Problem & Solution)
* **User Problem:** Manual code reviews are time-consuming and inconsistent, leading to bugs reaching production.
* **Proposed Solution:** AI agent analyzes pull requests in real-time, providing contextual feedback and suggested fixes.

### 3. Core Epics & Capabilities
* Epic: Real-time Code Analysis Engine
* Epic: Security Vulnerability Detection
* Epic: Performance Optimization Recommendations
* Epic: Team Collaboration Dashboard

### 4. Strategic Analysis
* **Evidence of Priority:** Real-time analysis appears central based on repeated emphasis and technical detail.
* **Market Differentiation:** Claims 90% faster review cycles compared to existing tools.
* **Key Risks & Unanswered Questions:** No mention of training data sources, accuracy metrics unclear, integration complexity not addressed.
```

### Advanced Configuration

#### Custom Model Selection
```bash
# Use specific text model
./picture.cmd analyze-url https://example.com \
  --text-model "qwen:32b" \
  --role marketing

# Configure vision model
./picture.cmd analyze-url https://image-heavy-blog.com \
  --vision-base-url http://localhost:11434 \
  --vision-model "llava:13b-v1.6" \
  --vision-provider ollama \
  --vision-system "Describe technical diagrams and charts in detail"
```

#### Output Management
```bash
# Organize results by date
./picture.cmd analyze-url https://example.com \
  --save \
  --output "analysis-$(date +%Y%m%d)"

# Debug mode with verbose logging
./picture.cmd analyze-url https://example.com \
  --debug \
  --role po \
  --save
```

### Development & Testing

```bash
# Run in development mode
npm run dev scrape https://example.com

# Test with different roles
npm run dev analyze-url https://test-site.com --role marketing
npm run dev analyze-url https://test-site.com --role po

# Build and test
npm run build
npm test
```

## 🔧 Configuration

### Environment Variables
Create a `.env` file in the project root:

```env
# AI Model Configuration
API_URL=http://localhost:11434/api/generate
TEXT_MODEL=Mistral-7B-Instruct-v0.2-Q4_K_M:latest

# Processing Settings
DEFAULT_TIMEOUT=300
REQUEST_COOLDOWN=1.0
MAX_RETRIES=3

# Output Settings
DEFAULT_OUTPUT_DIR=results
```

### Supported Models
- **Text Models**: Mistral, Llama3, Command-R, Qwen
- **Vision Models**: LLaVA, Qwen2-VL (via Ollama or llama.cpp)

## 🛠️ Tech Stack

### Core Technologies
- **TypeScript**: Type-safe development with modern ES features
- **Node.js 20+**: Runtime environment with latest performance optimizations
- **esbuild**: Ultra-fast bundling and compilation

### Web Scraping & Automation
- **Playwright**: Robust browser automation for dynamic content extraction
- **Chromium**: Headless browser engine for consistent rendering

### AI & Machine Learning
- **Ollama Integration**: Local LLM inference with support for multiple models
- **llama.cpp Support**: Alternative high-performance inference engine
- **Vision Model API**: Multi-modal analysis for image understanding

### CLI & User Experience
- **yargs**: Modern command-line argument parsing with subcommands
- **winston**: Structured logging with multiple output formats
- **ora**: Elegant terminal spinners and progress indicators
- **chalk**: Terminal string styling for better readability

### Development Tools
- **ESLint**: Code quality and consistency enforcement
- **Prettier**: Automatic code formatting
- **ts-node**: TypeScript execution for development workflows

## 📁 Project Architecture

```
picture-ts/
├── src/
│   ├── main.ts              # CLI entry point and command definitions
│   ├── index.ts             # Library exports for external consumption
│   ├── config.ts            # Configuration constants and environment setup
│   ├── types.ts             # TypeScript type definitions
│   ├── lib/                 # Utility libraries
│   │   ├── logger.ts        # Winston logging configuration
│   │   ├── ui.ts           # Terminal UI components
│   │   └── datauri.ts      # Image data URI conversion utilities
│   └── services/           # Core business logic
│       ├── pipeline.service.ts      # Main orchestration and workflow
│       ├── scraper.service.ts       # Web content extraction
│       ├── ollama.service.ts        # AI model communication
│       ├── vision.client.ts         # Vision model integration
│       ├── ocr.service.ts          # Image analysis coordination
│       ├── image-download.service.ts # Image fetching and caching
│       └── save-markdown.service.ts # Result formatting and export
├── dist/                   # Compiled JavaScript output
├── logs/                   # Application logs
├── models/                 # Local model configurations
└── results/               # Default output directory
```

### Design Principles

**Modular Architecture**: Each service handles a specific domain (scraping, AI inference, file I/O) with clear interfaces and minimal coupling.

**Type Safety**: Comprehensive TypeScript types ensure reliability and developer experience, with strict null checking and exhaustive type guards.

**Error Resilience**: Graceful degradation with retry logic, timeout handling, and detailed error reporting for production reliability.

**Performance Optimization**: Streaming responses, connection pooling, and intelligent caching minimize latency and resource usage.

**Extensibility**: Plugin-ready architecture supports multiple AI providers, output formats, and analysis roles without core changes.

This tool bridges the gap between web content analysis and AI-powered insights, making it easy to extract actionable intelligence from any online content source. Whether you're conducting competitive research, analyzing product opportunities, or extracting structured data from unstructured web content, Picture-TS provides the flexibility and power you need.
