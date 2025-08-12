#!/usr/bin/env bash
set -euo pipefail

IMG_PATH="$1"
MODEL="yasserrmd/Nanonets-OCR-s"  # could replace with qwen2.5-vl if installed
MIME="image/png"

if command -v file >/dev/null; then
  DETECTED=$(file --mime-type -b "$IMG_PATH")
  case "$DETECTED" in
    image/jpeg|image/png) MIME="$DETECTED" ;;
  esac
fi

if base64 --help 2>&1 | grep -q -- "-w"; then
  B64=$(base64 -w 0 "$IMG_PATH")
else
  B64=$(base64 "$IMG_PATH" | tr -d '\r\n')
fi

cat <<EOF | curl -s http://localhost:11434/api/chat -d @-
{
  "model": "$MODEL",
  "messages": [
    {
      "role": "user",
      "content": "Describe this image in detail. Mention objects, colors, setting, and any visible text.",
      "images": ["data:$MIME;base64,$B64"]
    }
  ],
  "options": { "temperature": 0 }
}
EOF
