"""Constants and configuration values for the image analyzer package."""

import os
from typing import Dict, List

# API configuration
API_URL = "http://localhost:11434/api/generate"
DEFAULT_TIMEOUT = 60  # seconds
REQUEST_COOLDOWN = 1.0  # Seconds between API requests (rate limiting)
MAX_RETRIES = 3  # Maximum number of retry attempts

# Image validation
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB limit
SUPPORTED_FORMATS = ['jpeg', 'jpg', 'png', 'gif']

# Model configuration
VISION_MODEL = "llava:34b"  # Using more powerful model for better analysis
TEXT_MODEL = "llama3:70b"  # Model for text summarization

# Progress display configuration
PROGRESS_STYLES = ["simple", "bar", "spinner", "none"]
DEFAULT_PROGRESS_STYLE = "bar"
SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
PROGRESS_BAR_LENGTH = 40
PROGRESS_REFRESH_RATE = 0.1  # seconds
TOKEN_RATE_WINDOW = 5.0  # Calculate token rate over this many seconds

# Estimated tokens for different models
ESTIMATED_TOKENS: Dict[str, int] = {
    "llava:13b": 300,       # Estimated tokens for standard image analysis
    "llava:34b": 500,       # Estimated tokens for detailed image analysis
    "llama3:8b": 200,       # Estimated tokens for text summarization
    "llama3:instruct": 200  # Estimated tokens for text summarization
}

# Default prompts
DEFAULT_ANALYSIS_PROMPT = """
You are an expert image analyst. Analyze the provided image in detail and extract all visible text.
Your analysis should include:
1. A general description of what's in the image
2. Any text content that appears in the image (exact transcription)
3. The layout and design elements
4. Any notable objects or features
Provide your analysis in a well-structured format.
"""

DEFAULT_SUMMARIZATION_PROMPT = "Please summarize the following text in a few key points:"

# Chunk processing prompts
CHUNK_ANALYSIS_PROMPT = """
You are analyzing chunk {chunk_number} of {total_chunks} from a larger image at coordinates {coordinates}.
Focus on extracting all visible text and describing what you see in this specific section.
If text appears to be cut off at the edges, mention that it continues beyond this section.
Provide:
1. All visible text with precise transcription
2. Description of visual elements in this section
3. How this section might relate to the rest of the image (e.g., "appears to be a header section")
"""

CHUNK_COMBINE_PROMPT = """
You have received analyses of {num_chunks} chunks from a single image that was divided for better processing.
Create a coherent, comprehensive analysis that combines all the information from these chunks.
Focus on:
1. Creating a unified description of the entire image
2. Assembling all text content in logical order
3. Eliminating redundancies from overlapping chunks
4. Providing a complete understanding of the image's content and purpose
"""

# Chunking settings
DEFAULT_CHUNK_MAX_DIM = 1200
DEFAULT_CHUNK_ASPECT_RATIO = 1.0
DEFAULT_CHUNK_OVERLAP = 0.2

# File paths
DEFAULT_OUTPUT_DIR = "results"
LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "image_analyzer.log")
