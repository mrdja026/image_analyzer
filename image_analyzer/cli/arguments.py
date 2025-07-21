"""Command line argument handling."""

import argparse
from ..config.constants import (
    VISION_MODEL, 
    TEXT_MODEL, 
    PROGRESS_STYLES, 
    DEFAULT_PROGRESS_STYLE,
    DEFAULT_CHUNK_MAX_DIM,
    DEFAULT_CHUNK_ASPECT_RATIO,
    DEFAULT_CHUNK_OVERLAP,
    ROLES,
    DEFAULT_ROLE
)

def parse_arguments():
    """
    Parse command line arguments.
    
    Returns:
        argparse.Namespace: Parsed arguments
    """
    parser = argparse.ArgumentParser(description="Image Analyzer and Text Summarizer")
    parser.add_argument("image_path", nargs="?", help="Path to the image file")
    parser.add_argument("--mode", "-m", choices=["analyze", "describe", "summarize", "all"], 
                      default="all", help="Processing mode (default: all)")
    parser.add_argument("--output", "-o", help="Output directory for saving results")
    parser.add_argument("--prompt", "-p", help="Custom prompt for image analysis")
    parser.add_argument("--vision-model", help=f"Vision model to use (default: {VISION_MODEL})")
    parser.add_argument("--text-model", help=f"Text model to use (default: {TEXT_MODEL})")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--save", "-s", action="store_true", help="Save results to files")
    parser.add_argument("--progress", choices=PROGRESS_STYLES, default=DEFAULT_PROGRESS_STYLE,
                      help=f"Progress display style (default: {DEFAULT_PROGRESS_STYLE})")
    parser.add_argument("--no-progress", action="store_true", help="Disable progress display")
    parser.add_argument("--role", "-r", choices=ROLES, default=DEFAULT_ROLE,
                      help=f"Role to use for summarization (default: {DEFAULT_ROLE})")
    
    # Image chunking options
    chunking_group = parser.add_argument_group("Image Chunking Options")
    chunking_group.add_argument("--use-chunking", action="store_true", 
                             help="Enable smart image chunking for better analysis of large images")
    chunking_group.add_argument("--save-chunks", action="store_true",
                             help="Save image chunks to disk for inspection")
    chunking_group.add_argument("--output-dir", 
                             help="Directory to save image chunks (if --save-chunks is used)")
    chunking_group.add_argument("--chunk-max-dim", type=int, default=DEFAULT_CHUNK_MAX_DIM,
                             help=f"Maximum dimension for image chunks (default: {DEFAULT_CHUNK_MAX_DIM}px)")
    chunking_group.add_argument("--chunk-aspect-ratio", type=float, default=DEFAULT_CHUNK_ASPECT_RATIO,
                             help=f"Target aspect ratio for chunks (default: {DEFAULT_CHUNK_ASPECT_RATIO}, 1.0 = square)")
    chunking_group.add_argument("--chunk-overlap", type=float, default=DEFAULT_CHUNK_OVERLAP,
                             help=f"Overlap percentage between chunks (default: {DEFAULT_CHUNK_OVERLAP}, 0.2 = 20%%)")
    
    return parser.parse_args()
