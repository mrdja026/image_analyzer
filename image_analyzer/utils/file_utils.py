"""File utilities for the image analyzer package."""

import os
import re
import time
from typing import Optional
from ..utils.logging_utils import get_logger

logger = get_logger()

def ensure_directory_exists(directory_path):
    """
    Ensure that a directory exists, creating it if necessary.
    
    Args:
        directory_path: Path to the directory
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        os.makedirs(directory_path, exist_ok=True)
        return True
    except Exception as e:
        logger.error(f"Failed to create directory {directory_path}: {e}")
        return False

def save_results(analysis: str = "", summary: str = "", output_dir: str = "results", 
               base_filename: Optional[str] = None, chunk_analyses: Optional[list] = None) -> bool:
    """
    Save analysis and summary results to files.
    
    Args:
        analysis: The analysis text to save
        summary: The summary text to save
        output_dir: Directory to save results in
        base_filename: Base filename to use (default: timestamp)
        chunk_analyses: Optional list of individual chunk analyses
        
    Returns:
        bool: True if saved successfully, False otherwise
    """
    try:
        # Create output directory if it doesn't exist
        ensure_directory_exists(output_dir)
        
        # Generate a filename based on timestamp if not provided
        if not base_filename:
            base_filename = time.strftime("%Y%m%d_%H%M%S")
        
        # Sanitize filename
        base_filename = re.sub(r'[^\w\-\.]', '_', base_filename)
        
        # Save analysis
        if analysis:
            analysis_path = os.path.join(output_dir, f"{base_filename}_analysis.txt")
            with open(analysis_path, "w", encoding="utf-8") as f:
                f.write(analysis)
            logger.info(f"Analysis saved to {analysis_path}")
        
        # Save summary
        if summary:
            summary_path = os.path.join(output_dir, f"{base_filename}_summary.txt")
            with open(summary_path, "w", encoding="utf-8") as f:
                f.write(summary)
            logger.info(f"Summary saved to {summary_path}")
            
        # Save individual chunk analyses if provided
        if chunk_analyses:
            chunks_dir = os.path.join(output_dir, f"{base_filename}_chunks")
            ensure_directory_exists(chunks_dir)
            
            for i, chunk_analysis in enumerate(chunk_analyses):
                chunk_path = os.path.join(chunks_dir, f"chunk_{i:03d}_analysis.txt")
                with open(chunk_path, "w", encoding="utf-8") as f:
                    f.write(chunk_analysis)
            
            logger.info(f"Saved {len(chunk_analyses)} chunk analyses to {chunks_dir}")
        
        return True
    except Exception as e:
        logger.error(f"Failed to save results: {e}")
        return False
