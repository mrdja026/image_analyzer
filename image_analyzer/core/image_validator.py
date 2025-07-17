"""Image validation functionality."""

import os
from typing import Optional
from PIL import Image  # Replacing deprecated imghdr

from ..config.constants import MAX_IMAGE_SIZE, SUPPORTED_FORMATS
from ..utils.logging_utils import get_logger

logger = get_logger()

def get_image_format(image_path: str) -> Optional[str]:
    """
    Get the format of an image file using PIL.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        str: Image format (lowercase) or None if not a supported image
    """
    try:
        with Image.open(image_path) as img:
            format_str = img.format.lower() if img.format else None
            return format_str
    except Exception:
        return None

def validate_image(image_path: str) -> bool:
    """
    Validates if the file is an image and checks its size.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        bool: True if valid, False otherwise
    """
    # Check if path exists
    if not os.path.exists(image_path):
        logger.error(f"File does not exist: {image_path}")
        return False
        
    # Check if it's a file and not a directory
    if os.path.isdir(image_path):
        logger.error(f"Path is a directory, not a file: {image_path}")
        return False
    
    # Check file size
    file_size = os.path.getsize(image_path)
    if file_size > MAX_IMAGE_SIZE:
        logger.error(f"Image size {file_size} bytes exceeds maximum allowed size of {MAX_IMAGE_SIZE} bytes")
        return False
    
    # Check if it's actually an image
    img_type = get_image_format(image_path)
    if not img_type or img_type not in SUPPORTED_FORMATS:
        logger.error(f"File is not a supported image format: {image_path}")
        logger.error(f"Detected format: {img_type if img_type else 'unknown'}")
        logger.error(f"Supported formats: {', '.join(SUPPORTED_FORMATS)}")
        return False
        
    return True
