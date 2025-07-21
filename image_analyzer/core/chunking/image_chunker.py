"""Image chunking functionality to improve analysis of large images."""

from typing import List, Tuple, Optional
import os
import tempfile
from PIL import Image

from ...utils.logging_utils import get_logger
from ...utils.image_utils import is_image_blank

logger = get_logger()

def calculate_optimal_chunks(image_width: int, image_height: int, 
                          target_aspect_ratio: Optional[float] = None, 
                          overlap_percent: float = 0.2, 
                          max_dim: int = 1200) -> List[Tuple[int, int, int, int]]:
    """
    Calculate optimal chunk coordinates for splitting an image.
    
    Args:
        image_width: Width of the original image
        image_height: Height of the original image
        target_aspect_ratio: Target width/height ratio (default: None for dynamic aspect ratio)
        overlap_percent: Percentage of overlap between chunks (default: 20%)
        max_dim: Maximum dimension for a chunk (default: 1200px)
        
    Returns:
        List of (left, top, right, bottom) coordinates for each chunk
    """
    # If no aspect ratio is provided, calculate a dynamic one based on image width
    if target_aspect_ratio is None:
        # For wider images, use wider chunks (good for text/OCR)
        # For narrower images, use more square chunks
        if image_width > 2000:
            target_aspect_ratio = 1.6  # Wide format, good for text
        elif image_width > 1200:
            target_aspect_ratio = 1.4  # Medium-wide format
        else:
            target_aspect_ratio = 1.2  # Closer to square for smaller images
    
    # Adjust max_dim if needed to maintain target aspect ratio
    if target_aspect_ratio > 1:
        # Width > height
        chunk_width = min(max_dim, image_width)
        chunk_height = int(chunk_width / target_aspect_ratio)
    else:
        # Height >= width
        chunk_height = min(max_dim, image_height)
        chunk_width = int(chunk_height * target_aspect_ratio)
    
    # Ensure chunk size doesn't exceed image dimensions
    chunk_width = min(chunk_width, image_width)
    chunk_height = min(chunk_height, image_height)
    
    # Calculate step size with overlap
    step_x = int(chunk_width * (1 - overlap_percent))
    step_y = int(chunk_height * (1 - overlap_percent))
    
    # Calculate number of chunks in each dimension
    num_x_chunks = max(1, (image_width - chunk_width) // step_x + 2)
    num_y_chunks = max(1, (image_height - chunk_height) // step_y + 2)
    
    chunks = []
    
    # Generate chunk coordinates
    for y in range(num_y_chunks):
        # Pre-calculate top for end-of-loop check
        top_y = min(y * step_y, image_height - chunk_height)
        
        for x in range(num_x_chunks):
            # Calculate top-left coordinates
            left = min(x * step_x, image_width - chunk_width)
            top = min(y * step_y, image_height - chunk_height)
            
            # Calculate bottom-right coordinates
            right = left + chunk_width
            bottom = top + chunk_height
            
            # Skip duplicate chunks
            if (left, top, right, bottom) not in chunks:
                chunks.append((left, top, right, bottom))
                
            # If we've reached the edge of the image, break
            if left + chunk_width >= image_width:
                break
                
        # If we've reached the bottom of the image, break
        if top_y + chunk_height >= image_height:
            break
    
    return chunks

def chunk_image(image_path: str, 
              target_aspect_ratio: Optional[float] = None, 
              overlap_percent: float = 0.2,
              max_dim: int = 1200,
              save_chunks: bool = False,
              output_dir: Optional[str] = None) -> List[Tuple[Image.Image, Tuple[int, int, int, int]]]:
    """
    Split an image into smaller, overlapping chunks with a target aspect ratio.
    
    Args:
        image_path: Path to the input image
        target_aspect_ratio: Target width/height ratio (default: None for dynamic aspect ratio)
                            When None, the aspect ratio will be determined based on the image width
        overlap_percent: Percentage of overlap between chunks (default: 20%)
        max_dim: Maximum dimension for a chunk (default: 1200px)
        save_chunks: Whether to save chunks to disk (default: False)
        output_dir: Directory to save chunks (default: None, uses temp directory)
        
    Returns:
        List of (PIL.Image, (left, top, right, bottom)) tuples
    """
    logger.info(f"Chunking image: {image_path}")
    
    try:
        # Open the image
        with Image.open(image_path) as img:
            width, height = img.size
            logger.info(f"Original image dimensions: {width}x{height}")
            
            # If the image is already reasonably sized with good aspect ratio, no chunking needed
            if width <= max_dim and height <= max_dim and 0.75 <= width/height <= 1.5:
                logger.info("Image doesn't need chunking - good size and aspect ratio")
                return [(img.copy(), (0, 0, width, height))]
            
            # Calculate chunk coordinates
            chunk_coords = calculate_optimal_chunks(
                width, height, target_aspect_ratio, overlap_percent, max_dim
            )
            
            logger.info(f"Splitting image into {len(chunk_coords)} chunks")
            
            result = []
            for i, (left, top, right, bottom) in enumerate(chunk_coords):
                # Crop the chunk
                chunk = img.crop((left, top, right, bottom))
                
                # Check if the chunk is blank or nearly blank
                if is_image_blank(chunk):
                    logger.info(f"Skipping blank chunk at coordinates ({left}, {top}, {right}, {bottom})")
                    continue
                
                # Save the chunk if requested
                if save_chunks:
                    if output_dir is None:
                        output_dir = tempfile.mkdtemp(prefix="image_chunks_")
                    
                    os.makedirs(output_dir, exist_ok=True)
                    chunk_path = os.path.join(output_dir, f"chunk_{i:03d}.png")
                    chunk.save(chunk_path)
                    logger.debug(f"Saved chunk {i} to {chunk_path}")
                
                # Add the chunk and its coordinates to the result
                result.append((chunk, (left, top, right, bottom)))
            
            logger.info(f"Created {len(result)} image chunks")
            return result
            
    except Exception as e:
        logger.error(f"Error chunking image: {e}")
        return []

def save_image_chunks(chunks: List[Tuple[Image.Image, Tuple[int, int, int, int]]], 
                    output_dir: str) -> List[str]:
    """
    Save image chunks to disk.
    
    Args:
        chunks: List of (PIL.Image, coordinates) tuples
        output_dir: Directory to save chunks
        
    Returns:
        List of saved file paths
    """
    os.makedirs(output_dir, exist_ok=True)
    
    saved_paths = []
    for i, (chunk, _) in enumerate(chunks):
        chunk_path = os.path.join(output_dir, f"chunk_{i:03d}.png")
        chunk.save(chunk_path)
        saved_paths.append(chunk_path)
        
    logger.info(f"Saved {len(saved_paths)} chunks to {output_dir}")
    return saved_paths
