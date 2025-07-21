"""Combined image processing and text summarization."""

from typing import Optional, Tuple

from .image_analyzer import analyze_image_with_ollama
from .text_summarizer import summarize_text
from ..config.constants import DEFAULT_PROGRESS_STYLE
from ..utils.logging_utils import get_logger

# Get logger
logger = get_logger()

def analyze_and_summarize_image(image_path: str, custom_prompt: Optional[str] = None, 
                              progress_style: str = DEFAULT_PROGRESS_STYLE,
                              role: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Analyzes an image and then summarizes the extracted text.
    
    Args:
        image_path: Path to the image file
        custom_prompt: Custom prompt for image analysis (optional)
        progress_style: Style of progress display to use
        role: Role to use for summarization ('po' or 'marketing')
        
    Returns:
        Tuple[Optional[str], Optional[str]]: (analysis, summary) or (None, None) if failed
    """
    logger.info(f"Starting combined analysis and summarization for: {image_path}")
    
    # First, analyze the image
    analysis = analyze_image_with_ollama(image_path, custom_prompt, progress_style)
    if not analysis:
        logger.error("Image analysis failed, cannot proceed to summarization")
        return None, None
    
    # Print the full analysis
    print("\n--- Image Analysis Result ---\n")
    print(analysis)
    
    # Then summarize the analysis
    logger.info(f"Proceeding to summarize the analysis result (role: {role or 'default'})")
    summary = summarize_text(analysis, progress_style, role)
    
    if summary:
        logger.info("Text summarization successful")
        print("\n--- Summary ---\n")
        print(summary)
        return analysis, summary
    else:
        logger.error("Text summarization failed")
        return analysis, None
