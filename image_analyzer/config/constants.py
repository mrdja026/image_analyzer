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
VISION_MODEL = "yasserrmd/Nanonets-OCR-s:latest"  # Using more powerful model for better analysis
TEXT_MODEL = "llama3"  # Model for text summarization

# Progress display configuration
PROGRESS_STYLES = ["simple", "bar", "spinner", "none"]
DEFAULT_PROGRESS_STYLE = "spinner"
SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
PROGRESS_BAR_LENGTH = 40
PROGRESS_REFRESH_RATE = 0.1  # seconds
TOKEN_RATE_WINDOW = 5.0  # Calculate token rate over this many seconds

# Estimated tokens for different models # This is a rough estimate based on model capabilities
# testing other models will require adjusting these values 
ESTIMATED_TOKENS: Dict[str, int] = {
    "yasserrmd/Nanonets-OCR-s:latest": 800, # Higher estimate for detailed OCR output
    "llava:13b": 300,
    "llava:34b": 500,
    "llama3": 200,                          # Matches your TEXT_MODEL = "llama3"
    "llama3:8b": 200,
    "llama3:instruct": 200,
    "mixtral": 300,                         # Add estimates for other models you test
    "command-r": 300                        # Add estimates for other models you test
}

# Default prompts
DEFAULT_ANALYSIS_PROMPT = "Extract all text content from the provided image. Preserve the original structure and formatting in markdown."

# Chunk processing prompts
CHUNK_ANALYSIS_PROMPT = "Extract all visible text content from this image chunk. Provide a precise transcription in markdown format."

CHUNK_COMBINE_PROMPT = """
You are a text assembly expert. You have received multiple text chunks that were extracted in order from a single larger image.
Your task is to synthesize these chunks into a single, coherent document.
- Assemble all text content in the correct, logical order.
- Intelligently merge text from overlapping areas to eliminate redundancy and create smooth transitions.
- The final output should be a single, clean markdown document that accurately represents the entire original image.
"""

# for llama3 to do a summary as a PO 
DEFAULT_SUMMARIZATION_PROMPT = """
You are a senior Product Owner analyzing a webpage for a potential usage for a tech company thet wants to transition on in the new technologies. Based on the following document, provide a concise summary for a competitive analysis report.
Address these specific points directly:

1.  **Product Identity:** What is this product or service in one clear sentence?
2.  **Core Value Proposition:** What is the main problem it solves for its users?
3.  **Target Audience:** Who is this product designed for? (e.g., marketers, developers, small businesses)
4.  **Key Features Mentioned:** List the 3-5 most prominent features or services advertised.
5.  **Final Recommendation:** Based on this information, is this a product a noteworthy for us? Provide a brief justification (e.g., 'High potential, strong feature set' or 'Generic offering, low threat').

Present the output in a clear, structured format.
"""
# Chunking settings
DEFAULT_CHUNK_MAX_DIM = 1024         # A more standard size for vision models. 1200 is also fine.
DEFAULT_CHUNK_ASPECT_RATIO = None    # Set to None or remove. We will NOT use this.
DEFAULT_CHUNK_OVERLAP = 0.15         # 15-20% is a good range.

# File paths
DEFAULT_OUTPUT_DIR = "results"
LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "image_analyzer.log")
