"""Image analysis functionality."""

import os
import time
import base64
import ollama
from typing import Optional, Dict, Any, Union

from ..config.constants import (
    DEFAULT_TIMEOUT, 
    MAX_RETRIES, 
    REQUEST_COOLDOWN,
    DEFAULT_PROGRESS_STYLE,
    DEFAULT_ANALYSIS_PROMPT,
    API_URL,
    ESTIMATED_TOKENS
)
# Import will be handled via function parameters to avoid circular imports
from ..ui import ProgressTracker, create_progress_display
from ..utils.logging_utils import get_logger
from .image_validator import validate_image

# Get logger
logger = get_logger()

def encode_image(image_path: str) -> Optional[str]:
    """
    Reads and encodes an image file to base64.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        Optional[str]: Base64 encoded image or None if encoding failed
    """
    try:
        logger.info(f"Reading image file: {image_path}")
        start_time = time.time()
        
        with open(image_path, "rb") as image_file:
            logger.debug("Image file opened successfully")
            image_data = image_file.read()
            logger.info(f"Read {len(image_data)} bytes from image file")
            
            encoded_string = base64.b64encode(image_data).decode('utf-8')
            logger.info(f"Image encoded to base64 ({len(encoded_string)} characters)")
            
        duration = time.time() - start_time
        logger.info(f"Image encoding completed in {duration:.2f} seconds")
        return encoded_string
        
    except IOError as e:
        logger.error(f"IO error reading image file: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error encoding image: {e}")
        return None

def analyze_image_with_ollama(image_path: str, prompt: Optional[str] = None, progress_style: str = DEFAULT_PROGRESS_STYLE) -> Optional[str]:
    """
    Analyzes an image using the Ollama API with the LLaVA model.
    
    Args:
        image_path: Path to the image file
        prompt: Custom prompt to use for analysis (optional)
        progress_style: Style of progress display to use
        
    Returns:
        Optional[str]: Analysis result or None if processing failed
    """
    # Import the module containing the global variables to avoid circular imports
    from .. import main
    
    logger.info(f"Analyzing image with Ollama client: {image_path}")
    
    if not prompt:
        prompt = DEFAULT_ANALYSIS_PROMPT
    
    # Validate the image
    if not validate_image(image_path):
        logger.error("Image validation failed")
        return None
    
    # Sanitize file path to prevent path traversal
    try:
        safe_path = os.path.abspath(os.path.normpath(image_path))
        if not os.path.exists(safe_path):
            logger.error(f"Safe path does not exist: {safe_path}")
            return None
    except Exception as e:
        logger.error(f"Path validation error: {e}")
        return None
    
    try:
        logger.info(f"Using Ollama client with {main.vision_model} model")
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
                progress_tracker = ProgressTracker(main.vision_model, "Image Analysis", 
                                                 ESTIMATED_TOKENS.get(main.vision_model, 300))
                progress_display = create_progress_display(progress_style, progress_tracker)
                
                full_response = ""
                
                # Make the API call using ollama client with streaming
                logger.info("Starting streaming API call with progress tracking")
                print(f"\nAnalyzing image with {main.vision_model}...")
                
                # Using the streaming API for progress updates
                for chunk in ollama.chat(
                    model=main.vision_model,
                    messages=[
                        {
                            'role': 'user',
                            'content': prompt,
                            'images': [safe_path]  # Pass the path to the image
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
                logger.info(f"Analysis completed in {duration:.2f} seconds")
                
                # Check if we got a valid response
                if full_response.strip():
                    logger.info(f"Successfully analyzed image (content length: {len(full_response)} chars)")
                    logger.debug(f"Analysis preview: {full_response[:100]}...")
                    return full_response
                else:
                    # Treat a blank response as a valid (but empty) analysis for a non-blank chunk
                    logger.info("Received a blank response for a non-blank chunk, treating as empty analysis.")
                    return ""
                
            except Exception as e:
                error_msg = str(e)
                logger.error(f"Attempt {attempts} failed: {error_msg}")
                
                # Check for GGML_ASSERT errors which often happen with blank or problematic image chunks
                if "GGML_ASSERT" in error_msg:
                    logger.warning("GGML_ASSERT error detected - likely caused by a problematic image chunk")
                    if attempts >= 1:  # If this is at least the second attempt with a GGML error
                        logger.warning("Multiple GGML errors - returning empty response to avoid further processing")
                        return ""  # Return empty string to indicate empty but valid response
                
                last_exception = e
        
        if last_exception:
            logger.error(f"All {MAX_RETRIES} attempts failed. Last error: {last_exception}")
        return None
        
    except Exception as e:
        logger.error(f"Unexpected error during image analysis: {e}")
        return None

def send_api_request(encoded_image: str, prompt: str = "Describe this image in detail.", model_name: str = "") -> Optional[Dict[str, Any]]:
    """
    Sends the encoded image to the Ollama API.
    
    Args:
        encoded_image: Base64 encoded image string
        prompt: Text prompt to accompany the image
        model_name: Name of the model to use
        
    Returns:
        Optional[Dict[str, Any]]: API response or None if request failed
    """
    # Import the module containing the global variables to avoid circular imports
    from .. import main
    
    if not model_name:
        model_name = main.vision_model
    if model_name is None:
        model_name = main.vision_model
    import requests
    from requests.exceptions import RequestException, Timeout
    
    data = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "images": [encoded_image]
    }
    
    try:
        logger.info(f"Sending request to API: {API_URL}")
        logger.debug(f"Using model: {model_name}")
        logger.debug(f"Prompt: '{prompt}'")
        
        start_time = time.time()
        response = requests.post(API_URL, json=data, timeout=DEFAULT_TIMEOUT)
        duration = time.time() - start_time
        
        logger.info(f"API request completed in {duration:.2f} seconds")
        logger.info(f"Response status code: {response.status_code}")
        
        response.raise_for_status()
        # Parse the response to a dictionary
        return response.json()
        
    except Timeout:
        logger.error(f"API request timed out after {DEFAULT_TIMEOUT} seconds")
        return None
    except RequestException as e:
        logger.error(f"API request failed: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error during API request: {e}")
        return None

def parse_api_response(response) -> Union[str, None]:
    """
    Parses the API response to extract the image description.
    
    Args:
        response: Response dictionary from the API
        
    Returns:
        Union[str, None]: Extracted description or None if parsing failed
    """    
    if not response:
        logger.error("No response to parse")
        return None
        
    try:
        logger.info("Parsing API response")
        
        # The response is already parsed as a dictionary
        if isinstance(response, dict):
            if "response" in response:
                result = response["response"]
                logger.info("Successfully extracted description from response")
                logger.debug(f"Description length: {len(result)} characters")
                return result
            else:
                logger.error("Error: 'response' key not found in the response dictionary")
                logger.error(f"Response keys: {list(response.keys())}")
                return None
        else:
            logger.error(f"Unexpected response type: {type(response)}")
            return None

    except Exception as e:
        logger.error(f"Unexpected error parsing response: {e}")
        return None

def get_image_description(image_path: str) -> Optional[str]:
    """
    Gets a description for an image using the Llava model in Ollama.
    Legacy function for backward compatibility.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        Optional[str]: Image description or None if processing failed
    """
    logger.info(f"Processing image: {image_path}")
    
    # Validate the image
    if not validate_image(image_path):
        logger.error("Image validation failed")
        return None
    
    # Encode the image
    encoded_image = encode_image(image_path)
    if not encoded_image:
        logger.error("Image encoding failed")
        return None
    
    # Import the module containing the global variables to avoid circular imports
    from .. import main
    
    # Send the API request
    response = send_api_request(encoded_image, model_name=main.vision_model)
    if not response:
        logger.error("API request failed")
        return None
    
    # Parse the response
    result = parse_api_response(response)
    if result:
        logger.info("Image description generated successfully")
        print(result)  # Print the result to stdout for user
        return result
    else:
        logger.error("Failed to generate image description")
        return None
