"""Main application logic."""

import os
import sys
import logging
import shutil
from PIL import Image

from .cli import parse_arguments
from .core import (
    analyze_image_with_ollama, 
    get_image_description,
    summarize_text,
    analyze_and_summarize_image,
    analyze_image_in_chunks
)
from .utils import save_results, is_interactive_terminal
from .utils.logging_utils import get_logger
from .config.constants import (
    DEFAULT_CHUNK_MAX_DIM,
    VISION_MODEL as DEFAULT_VISION_MODEL,
    TEXT_MODEL as DEFAULT_TEXT_MODEL
)

logger = get_logger()

# Global variables for model names - will be initialized with defaults and can be overridden by CLI args
vision_model = DEFAULT_VISION_MODEL
text_model = DEFAULT_TEXT_MODEL

def main():
    """
    Main entry point for the script.
    
    Returns:
        int: Exit code (0 for success, non-zero for failure)
    """
    try:
        # Parse command line arguments
        args = parse_arguments()
        
        # Set debug logging if requested
        if args.debug:
            logger.setLevel(logging.DEBUG)
            logger.debug("Debug logging enabled")
        
        logger.info("Image Analyzer and Summarizer started")
        
        # Override models if specified
        global vision_model, text_model
        
        if args.vision_model:
            vision_model = args.vision_model
            logger.info(f"Using custom vision model: {vision_model}")
        if args.text_model:
            text_model = args.text_model
            logger.info(f"Using custom text model: {text_model}")
        
        # Check if image path is provided
        if not args.image_path:
            logger.error("No image path provided")
            print("Usage: python -m image_analyzer <path_to_image> [options]", file=sys.stderr)
            print("Run 'python -m image_analyzer --help' for more information", file=sys.stderr)
            return 1
        
        image_path = args.image_path
        logger.info(f"Input image path: {image_path}")
        
        # Determine progress style
        progress_style = "none" if args.no_progress else args.progress
        logger.info(f"Using progress style: {progress_style}")
        
        # Check if image needs chunking
        needs_chunking = False
        try:
            with Image.open(image_path) as img:
                width, height = img.size
                # If image is large or has extreme aspect ratio, use chunking
                if width > DEFAULT_CHUNK_MAX_DIM or height > DEFAULT_CHUNK_MAX_DIM or width/height > 3 or height/width > 3:
                    needs_chunking = True
                    logger.info(f"Image dimensions {width}x{height} suggest chunking is needed")
        except Exception as e:
            logger.warning(f"Could not check image dimensions: {e}")
            
        # Process based on mode
        analysis = None
        summary = None
        chunk_analyses = []
        summary_already_printed = False
        
        if args.mode in ["analyze", "all"]:
            if needs_chunking and args.use_chunking:
                # Use chunking for large images
                logger.info("Using image chunking for analysis")
                analysis, chunk_analyses = analyze_image_in_chunks(
                    image_path, 
                    args.prompt, 
                    progress_style,
                    target_aspect_ratio=args.chunk_aspect_ratio,
                    overlap_percent=args.chunk_overlap,
                    max_dim=args.chunk_max_dim,
                    save_chunks=args.save_chunks,
                    output_dir=args.output_dir
                )
                
                # In chunking mode, the analysis result is already a summary of all chunks
                if analysis:
                    logger.info("Successfully combined chunk analyses")
                    # Store the result as both analysis and summary to avoid reprocessing
                    summary = analysis
                    
                    # Print the analysis result if in "all" mode
                    if args.mode == "all":
                        print("\n--- Combined Analysis Result ---\n")
                        print(analysis)
                        # Flag that we've already printed it once
                        summary_already_printed = True
                else:
                    logger.error("Failed to combine chunk analyses")
            else:
                # Standard analysis
                analysis = analyze_image_with_ollama(image_path, args.prompt, progress_style)
                
            if not analysis:
                logger.error("Analysis failed")
                return 1
                
            if args.mode == "analyze":
                # Print only if not in "all" mode (to avoid duplicate output)
                print("\n--- Image Analysis Result ---\n")
                print(analysis)
        
        elif args.mode == "describe":
            # Legacy mode - use the old function
            result = get_image_description(image_path)
            if not result:
                logger.error("Description failed")
                return 1
            return 0
            
        if args.mode in ["summarize", "all"] and analysis:
            # Summarize the analysis
            # Skip if we already got a summary from the chunking process
            if not chunk_analyses:
                summary = summarize_text(analysis, progress_style)
            else:
                # For chunking mode, the combined analysis is already processed and can serve as a summary
                summary = analysis  # The combined analysis is already summarized
            
            # Print summary for summarize mode, or for all mode if not already printed
            if (args.mode == "summarize" or (args.mode == "all" and not summary_already_printed)) and summary:
                print("\n--- Summary ---\n")
                print(summary)
        
        # If "all" mode, handle display of results
        if args.mode == "all":
            if not (needs_chunking and args.use_chunking):
                # For non-chunking mode, we need to actually run the analysis and summarization
                # since it hasn't been done yet
                analysis, summary = analyze_and_summarize_image(image_path, args.prompt, progress_style)
                # analyze_and_summarize_image already prints both analysis and summary
        
        # Save results if requested
        if args.save and (analysis or summary):
            output_dir = args.output or "results"
            base_filename = os.path.splitext(os.path.basename(image_path))[0]
            # Only pass analysis and summary if they are not None
            analysis_to_save = analysis if analysis else ""
            summary_to_save = summary if summary else ""
            save_results(analysis_to_save, summary_to_save, output_dir, base_filename, 
                      chunk_analyses=chunk_analyses if chunk_analyses else None)
        
        logger.info("Process completed successfully")
        return 0
        
    except KeyboardInterrupt:
        # Clear the current line in case we're interrupting a progress display
        if is_interactive_terminal():
            sys.stdout.write("\r" + " " * shutil.get_terminal_size().columns + "\r")
            sys.stdout.flush()
        logger.info("Process interrupted by user")
        return 130  # Standard exit code for SIGINT
        
    except Exception as e:
        logger.error(f"Unhandled exception: {e}", exc_info=True)
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        return 1
