# Stage 1: Build llama.cpp with GGUF support
#wont work, need to do it via wsl, cant work in docker in windows
FROM ubuntu:22.04 as builder

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    curl \
    wget \
    python3 \
    python3-pip \
    libopenblas-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

# Clone llama.cpp (or your preferred backend for GGUF models)
RUN git clone https://github.com/ggerganov/llama.cpp.git
WORKDIR /opt/llama.cpp
RUN make LLAMA_CUBLAS=1 -j #wont work, need to do it via wsl, cant work in docker in windows

# Stage 2: Node.js + runtime
FROM node:18-slim

# Copy llama.cpp build from previous stage
COPY --from=builder /opt/llama.cpp /llama.cpp

# Install runtime deps
RUN apt-get update && apt-get install -y libopenblas-dev && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy Node app
COPY app/package*.json ./
RUN npm install
COPY app .

# Copy models into container
COPY models /models

# Expose port for your Node API
EXPOSE 3000

# Script to:
# 1. Start Ollama or llama.cpp server
# 2. Wait for readiness
# 3. Start Node.js app
CMD [ "sh", "-c", "\
  ./llama.cpp/server --model /models/mistral.gguf --host 0.0.0.0 --port 11434 & \
  sleep 10 && \
  node index.js \