#!/usr/bin/env bash
# Usage: ./test_qwen_ocr.sh [--text-only] "C:\path\to\image.jpg"
# Requires: ollama running locally, curl, base64

set -euo pipefail

TEXT_ONLY=false
if [ "$1" == "--text-only" ]; then
  TEXT_ONLY=true
  shift
fi

if [ $# -lt 1 ]; then
  echo "Usage: $0 [--text-only] /path/to/image"
  exit 1
fi

# Convert Windows path C:\... to /c/... for Git Bash
IMG_PATH="$1"
if [[ "$IMG_PATH" =~ ^[A-Za-z]:\\ ]]; then
  DRIVE_LETTER=$(echo "$IMG_PATH" | cut -c1 | tr 'A-Z' 'a-z')
  REST_PATH=$(echo "$IMG_PATH" | cut -c3- | tr '\\' '/')
  IMG_PATH="/$DRIVE_LETTER/$REST_PATH"
fi

# Check if file exists
if [ ! -f "$IMG_PATH" ]; then
  echo "❌ File not found: $IMG_PATH"
  exit 1
fi

MODEL="qwen2.5vl:7b"

# Detect MIME type
MIME="image/jpeg"
if command -v file >/dev/null; then
  DETECTED=$(file --mime-type -b "$IMG_PATH" 2>/dev/null || true)
  case "$DETECTED" in
    image/jpeg|image/png) MIME="$DETECTED" ;;
  esac
fi

# Encode to base64 without wrapping
B64=$(cat "$IMG_PATH" | base64 | tr -d '\r\n')

# Send to Ollama API
RESPONSE=$(cat <<EOF | curl -s http://localhost:11434/api/chat -d @-
{
  "model": "$MODEL",
  "system": "You are a precise OCR+caption engine. Output Markdown only.",
  "messages": [
    {
      "role": "user",
      "content": "Describe the image in detail and transcribe any visible text.",
      "images": ["data:$MIME;base64,$B64"]
    }
  ],
  "options": { "temperature": 0 }
}
EOF
)

if $TEXT_ONLY; then
  echo "$RESPONSE" | grep -o '"content":"[^"]*"' | sed 's/"content":"//; s/"$//; s/\\n/\n/g'
else
  echo "$RESPONSE"
fi
