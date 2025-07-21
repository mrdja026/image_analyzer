"""Image utilities for the image analyzer package."""

from PIL import Image

def is_image_blank(image: Image.Image, threshold: int = 10) -> bool:
    """
    Check if an image is blank (i.e., a single solid color) or nearly blank.
    This function handles various image modes and detects images unlikely to contain useful content.
    
    Args:
        image: The PIL Image object to check.
        threshold: The maximum difference in pixel values to be considered blank.
                  Higher values will detect more images as blank.
        
    Returns:
        True if the image is blank or nearly blank, False otherwise.
    """
    try:
        # First handle the case where extrema might fail
        if image.mode == "F":  # Float32 images
            # Convert to 8-bit grayscale for analysis
            image = image.convert("L")
            
        # Calculate the percentage of the image that is solid color
        # Convert to grayscale for a simpler histogram
        gray_img = image.convert("L")
        hist = gray_img.histogram()
        
        # Calculate the dominant color percentage
        total_pixels = gray_img.width * gray_img.height
        if total_pixels == 0:  # Empty image
            return True
            
        # Get the most common pixel value and its count
        max_count = max(hist)
        dominant_ratio = max_count / total_pixels
        
        # If one color dominates more than 95% of the image, consider it blank
        if dominant_ratio > 0.95:
            return True
            
        # Get the image extrema (min/max values for each band)
        extrema = image.getextrema()
        
        # Edge case: Some modes might return a single value or None
        if not isinstance(extrema, (list, tuple)):
            return True
            
        # For multi-band images (RGB, RGBA, etc.)
        if isinstance(extrema, tuple) and len(extrema) > 0 and isinstance(extrema[0], (list, tuple)):
            # Check if all bands have similar min/max (nearly solid color)
            for band_extrema in extrema:
                if isinstance(band_extrema, (tuple, list)) and len(band_extrema) >= 2:
                    # Consider nearly solid if the difference is less than threshold
                    if band_extrema[1] - band_extrema[0] > threshold:
                        return False
            return True
            
        # For single-band images (L, 1, etc.)
        elif isinstance(extrema, tuple) and len(extrema) == 2:
            # Make sure both values are numeric
            if isinstance(extrema[0], (int, float)) and isinstance(extrema[1], (int, float)):
                # Consider nearly solid if the difference is less than threshold
                if abs(extrema[1] - extrema[0]) > threshold:
                    return False
            return True
            
        # Unknown format, default to not blank to be safe
        return False
        
    except Exception as e:
        # If we can't analyze it properly, log and assume it's not blank
        # to avoid skipping potentially valid content
        print(f"Error analyzing image blankness: {e}")
        return False

def get_image_dimensions(image_path: str) -> tuple[int, int] | None:
    """
    Get the dimensions of an image without loading the full image into memory.

    Args:
        image_path: The path to the image file.

    Returns:
        A tuple (width, height) or None if the dimensions cannot be determined.
    """
    try:
        with Image.open(image_path) as img:
            return img.size
    except Exception:
        return None
