"""Text summarization functionality."""

import re
import time
import ollama
from typing import Optional

from ..config.constants import (
    REQUEST_COOLDOWN,
    MAX_RETRIES,
    DEFAULT_PROGRESS_STYLE,
    DEFAULT_SUMMARIZATION_PROMPT,
    ESTIMATED_TOKENS
)
# Import will be handled via function parameters to avoid circular imports
from ..ui import ProgressTracker, create_progress_display
from ..utils.logging_utils import get_logger

# Get logger
logger = get_logger()

def summarize_text(text: str, progress_style: str = DEFAULT_PROGRESS_STYLE) -> Optional[str]:
    """
    Summarizes text using the Llama model in Ollama.
    
    Args:
        text: The text to summarize
        progress_style: Style of progress display to use
        
    Returns:
        Optional[str]: Summarized text or None if processing failed
    """
    # Import the module containing the global variables to avoid circular imports
    from .. import main
    if not text or len(text.strip()) < 10:
        logger.error("Text too short to summarize")
        return None
    
    # Sanitize input text (prevent prompt injection)
    text = re.sub(r'[^\w\s.,;:!?()\[\]{}\'"+-]', '', text)
    
    logger.info(f"Summarizing text (length: {len(text)} chars)")
    logger.debug(f"Text preview: {text[:100]}...")
    
    try:
        start_time = time.time()
        
        # Track attempts for retry logic
        attempts = 0
        last_exception = None
        
        while attempts < MAX_RETRIES:
            try:
                # Rate limiting
                if attempts > 0:
                    time.sleep(REQUEST_COOLDOWN * (2 ** attempts))  # Exponential backoff
                    logger.info(f"Retrying attempt {attempts+1}/{MAX_RETRIES}")
                
                attempts += 1
                
                # Set up progress tracking
                progress_tracker = ProgressTracker(main.text_model, "Text Summarization", ESTIMATED_TOKENS.get(main.text_model, 200))
                progress_display = create_progress_display(progress_style, progress_tracker)
                
                full_response = ""
                
                # Make the API call with streaming
                logger.info("Starting streaming API call for summarization with progress tracking")
                print(f"\nSummarizing text with {main.text_model}...")
                
                # Using the streaming API for progress updates
                for chunk in ollama.chat(
                    model=main.text_model,
                    messages=[
                        {
                            'role': 'user',
                            'content': f"{DEFAULT_SUMMARIZATION_PROMPT}\n\n{text}"
                        }
                    ],
                    stream=True
                ):
                    # Process each chunk
                    if 'message' in chunk and 'content' in chunk['message']:
                        content_chunk = chunk['message']['content']
                        full_response += content_chunk
                        
                        # Update progress
                        progress_tracker.update(full_response)
                        if progress_display:
                            progress_display.update_display()
                
                # Complete the progress display
                if progress_display:
                    progress_tracker.complete()
                    progress_display.complete()
                
                duration = time.time() - start_time
                logger.info(f"Summarization completed in {duration:.2f} seconds")
                
                # Check if we got a valid response
                if full_response:
                    logger.info(f"Successfully summarized text (summary length: {len(full_response)} chars)")
                    logger.debug(f"Summary preview: {full_response[:100]}...")
                    return full_response
                else:
                    logger.error("Empty response from Ollama")
                    last_exception = ValueError("Empty response")
                    continue
            
            except Exception as e:
                logger.error(f"Attempt {attempts} failed: {str(e)}")
                last_exception = e
        
        if last_exception:
            logger.error(f"All {MAX_RETRIES} attempts failed. Last error: {last_exception}")
        return None
        
    except Exception as e:
        logger.error(f"Unexpected error during text summarization: {e}")
        return None
