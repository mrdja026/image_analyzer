# Blog Reviews API

This is the API server for the Blog Reviews application, which provides image analysis and summarization capabilities through a REST API. The API integrates with the `picture-ts` library to perform OCR, chunking, and analysis of images.

## Features

- Image upload and processing
- OCR extraction using Ollama vision models
- Text analysis and summarization
- Real-time progress tracking via Server-Sent Events (SSE)
- Support for custom prompts and role-based analysis

## Prerequisites

- Node.js 18+ 
- Ollama installed and running locally
- Required models loaded in Ollama:
  - `qwen2-ocr2-2b:latest` (or similar vision model)
  - `Mistral-7B-Instruct-v0.2-Q4_K_M:latest` (or similar text model)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the API:
   ```bash
   node build.js
   ```

3. Start the API server:
   ```bash
   npm run start
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port to run the API server on | `3001` |
| `FORCE_GRID_CHUNKING` | Set to `1` or `true` to disable OpenCV content-aware chunking and use grid-based chunking instead | `false` |
| `OPENCV_WASM_PATH` | Path to the OpenCV WASM file (only needed if not using `FORCE_GRID_CHUNKING`) | Auto-detected |

## OpenCV WASM Issues

The API requires OpenCV WASM for content-aware chunking. If you encounter issues with OpenCV WASM initialization, you can:

1. **Use grid-based chunking instead**:
   ```bash
   # Windows PowerShell
   $env:FORCE_GRID_CHUNKING = "true"
   npm run start
   
   # Linux/macOS
   FORCE_GRID_CHUNKING=true npm run start
   ```

   This will bypass OpenCV initialization entirely and use a simple grid-based chunking algorithm instead. This is less intelligent but more reliable.

2. **Manually provide the WASM path** (if you have the file):
   ```bash
   # Windows PowerShell
   $env:OPENCV_WASM_PATH = "path/to/opencv_js.wasm"
   npm run start
   
   # Linux/macOS
   OPENCV_WASM_PATH=path/to/opencv_js.wasm npm run start
   ```

## API Endpoints

### Health Check
```
GET /api/health
```

### Upload Image
```
POST /api/upload
Content-Type: multipart/form-data
Body: { image: <file> }
```

### Stream Progress
```
GET /api/stream/:jobId
```

### Analyze Text
```
POST /api/analyze
Content-Type: application/json
Body: { 
  jobId: "job_id_from_upload", 
  role: "marketing" | "po", // optional
  prompt: "custom prompt" // optional, overrides role
}
```

## Example Usage

1. Upload an image:
   ```bash
   curl.exe -F "image=@path/to/image.jpg" http://localhost:3001/api/upload
   ```
   
   Response:
   ```json
   {"jobId":"a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6"}
   ```

2. Connect to SSE stream to monitor progress:
   ```
   GET http://localhost:3001/api/stream/a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6
   ```

3. Analyze the extracted text:
   ```bash
   curl.exe -X POST -H "Content-Type: application/json" -d "{\"jobId\":\"a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6\",\"role\":\"marketing\"}" http://localhost:3001/api/analyze
   ```

## Troubleshooting

- If you see `OpenCV failed to initialize` errors, use the `FORCE_GRID_CHUNKING=true` environment variable to bypass OpenCV.
- If the API server crashes on startup, check that Ollama is running and accessible.
- For image processing errors, try using smaller images or setting `FORCE_GRID_CHUNKING=true`.

IT KINDA WORKS, CANNOT test 
2025-08-08 00:39:37 [INFO]: Processing chunk 1/4 
2025-08-08 00:39:37 [INFO]: Extracting text from image chunk 
2025-08-08 00:39:41 [INFO]: Processing chunk 2/4 
2025-08-08 00:39:41 [INFO]: Extracting text from image chunk 
2025-08-08 00:39:42 [INFO]: Processing chunk 3/4 
2025-08-08 00:39:42 [INFO]: Extracting text from image chunk 
2025-08-08 00:39:43 [INFO]: Processing chunk 4/4 
2025-08-08 00:39:43 [INFO]: Extracting text from image chunk 
2025-08-08 00:39:45 [INFO]: Successfully extracted text from 4/4 chunks 
2025-08-08 00:39:45 [INFO]: Combining extracted text from all chunks 
2025-08-08 00:39:45 [INFO]: Combining 4 text chunks
