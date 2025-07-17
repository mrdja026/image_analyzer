#!/usr/bin/env python
"""
Test script to demonstrate the image chunking functionality.
This script shows how to use the chunking API programmatically.
"""

import os
import sys
from pathlib import Path
from typing import Optional, List, Tuple

# Add the parent directory to the path
parent_dir = str(Path(__file__).resolve().parent)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from image_analyzer.core import analyze_image_in_chunks, chunk_image, save_image_chunks
from image_analyzer.utils.logging_utils import get_logger, setup_logger

# Set up logging
logger = setup_logger("ChunkingDemo", "logs/chunking_demo.log", level="DEBUG")

def demo_chunking(image_path: str, save_chunks: bool = False, output_dir: Optional[str] = None) -> int:
    """
    Demonstrate the image chunking functionality.
    
    Args:
        image_path: Path to the image to analyze
        save_chunks: Whether to save the image chunks
        output_dir: Directory to save chunks and results
        
    Returns:
        int: Exit code (0 for success, 1 for error)
    """
    if not os.path.exists(image_path):
        print(f"Error: Image file not found: {image_path}")
        return 1
    
    # If output_dir specified but save_chunks not explicitly set, enable saving
    if output_dir and not save_chunks:
        save_chunks = True
    
    if save_chunks and not output_dir:
        output_dir = "chunking_demo_output"
        
    if save_chunks and output_dir:
        os.makedirs(output_dir, exist_ok=True)
        
    print(f"Analyzing image: {image_path}")
    print(f"{'Saving chunks to: ' + str(output_dir) if save_chunks and output_dir else 'Not saving chunks'}")
    print("-" * 40)
    
    # Option 1: Just chunk the image without analysis
    if save_chunks and output_dir:
        print("\nOption 1: Chunking the image without analysis")
        chunks_dir = os.path.join(str(output_dir), "chunks_only")
        chunks = chunk_image(
            image_path, 
            target_aspect_ratio=1.0,
            overlap_percent=0.2,
            max_dim=800,
            save_chunks=True,
            output_dir=chunks_dir
        )
        print(f"Created {len(chunks)} image chunks")
    
    # Option 2: Full chunked analysis
    print("\nOption 2: Full chunked analysis")
    analysis_dir = None
    if save_chunks and output_dir:
        analysis_dir = os.path.join(str(output_dir), "analysis_chunks")
    
    analysis, chunk_analyses = analyze_image_in_chunks(
        image_path,
        prompt="Analyze this image with special attention to any text content",
        progress_style="bar",
        target_aspect_ratio=1.0,
        overlap_percent=0.2,
        max_dim=800,
        save_chunks=save_chunks,
        output_dir=analysis_dir
    )
    
    print("\n=== Combined Analysis ===\n")
    if analysis:
        print(analysis)
    else:
        print("No analysis generated.")
    
    print(f"\n=== {len(chunk_analyses)} Individual Chunk Analyses ===\n")
    for i, chunk_analysis in enumerate(chunk_analyses):
        print(f"\n--- Chunk {i+1} ---")
        print(chunk_analysis[:200] + "..." if len(chunk_analysis) > 200 else chunk_analysis)
    
    # Save the combined analysis
    if save_chunks and output_dir and analysis:
        analysis_path = os.path.join(str(output_dir), "combined_analysis.txt")
        with open(analysis_path, "w", encoding="utf-8") as f:
            f.write(analysis)
        print(f"\nSaved combined analysis to {analysis_path}")
    
    return 0

def main():
    """Entry point for the demo script."""
    # Parse command line arguments
    import argparse
    parser = argparse.ArgumentParser(description="Demonstrate image chunking functionality")
    parser.add_argument("image_path", help="Path to the image to analyze")
    parser.add_argument("--save-chunks", "-s", action="store_true", help="Save image chunks")
    parser.add_argument("--output-dir", "-o", help="Directory to save chunks and results")
    
    args = parser.parse_args()
    
    return demo_chunking(args.image_path, args.save_chunks, args.output_dir)

if __name__ == "__main__":
    sys.exit(main())
