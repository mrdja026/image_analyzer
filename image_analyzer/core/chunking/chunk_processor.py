"""Process image chunks and combine analysis results."""

from typing import List, Tuple, Optional
import os
import time
import tempfile
from PIL import Image

from ..image_analyzer import analyze_image_with_ollama
from ..text_summarizer import summarize_text
from .image_chunker import chunk_image, save_image_chunks
from ...config.constants import DEFAULT_PROGRESS_STYLE, CHUNK_ANALYSIS_PROMPT, CHUNK_COMBINE_PROMPT
from ...utils.image_utils import is_image_blank
from ...utils.logging_utils import get_logger

logger = get_logger()

def analyze_image_in_chunks(image_path: str, 
                           prompt: Optional[str] = None,
                           progress_style: str = DEFAULT_PROGRESS_STYLE,
                           target_aspect_ratio: Optional[float] = None, 
                           overlap_percent: float = 0.2,
                           max_dim: int = 1200,
                           save_chunks: bool = False,
                           output_dir: Optional[str] = None) -> Tuple[Optional[str], List[str]]:
    """
    Analyze a large image by splitting it into chunks, analyzing each chunk,
    and combining the results.
    
    Args:
        image_path: Path to the image file
        prompt: Custom prompt for image analysis (optional)
        progress_style: Style of progress display to use
        target_aspect_ratio: Target width/height ratio for chunks (None for dynamic ratio)
        overlap_percent: Percentage of overlap between chunks
        max_dim: Maximum dimension for a chunk
        save_chunks: Whether to save chunks to disk
        output_dir: Directory to save chunks (if save_chunks is True)
        
    Returns:
        Tuple of (combined analysis, list of individual chunk analyses)
    """
    logger.info(f"Starting chunked analysis for image: {image_path}")
    
    # Split the image into chunks
    if save_chunks and output_dir is None:
        output_dir = os.path.join(tempfile.gettempdir(), "image_chunks")
        os.makedirs(output_dir, exist_ok=True)
    
    chunks = chunk_image(
        image_path, 
        target_aspect_ratio=target_aspect_ratio, 
        overlap_percent=overlap_percent,
        max_dim=max_dim,
        save_chunks=save_chunks,
        output_dir=output_dir
    )
    
    if not chunks:
        logger.error("Failed to create image chunks")
        return None, []
    
    # If we only have one chunk, just analyze it directly
    if len(chunks) == 1:
        logger.info("Only one chunk needed, analyzing directly")
        analysis = analyze_image_with_ollama(image_path, prompt, progress_style)
        return analysis, [analysis] if analysis else []
    
    # Save chunks to temporary files for analysis
    temp_dir = tempfile.mkdtemp(prefix="image_analysis_chunks_")
    chunk_paths = []
    
    try:
        # Save chunks to temporary files
        for i, (chunk, coords) in enumerate(chunks):
            chunk_path = os.path.join(temp_dir, f"chunk_{i:03d}.png")
            chunk.save(chunk_path)
            chunk_paths.append(chunk_path)
            
        logger.info(f"Saved {len(chunk_paths)} chunks for analysis")
        
        # Analyze each chunk
        chunk_analyses = []
        chunk_prompts = []
        valid_chunk_paths = []
        valid_chunks_idx = []
        
        # First, check if each chunk is valid (not blank)
        for i, chunk_path in enumerate(chunk_paths):
            logger.info(f"Validating chunk {i+1}/{len(chunk_paths)}")
            
            # Check if the chunk is blank
            try:
                chunk_img = Image.open(chunk_path)
                if is_image_blank(chunk_img):
                    logger.info(f"Skipping blank chunk {i+1}")
                    continue
                valid_chunk_paths.append(chunk_path)
                valid_chunks_idx.append(i)
            except Exception as e:
                logger.error(f"Error validating chunk {i+1}: {e}")
                continue
        
        logger.info(f"Found {len(valid_chunk_paths)}/{len(chunk_paths)} valid chunks for analysis")
        
        if not valid_chunk_paths:
            logger.error("No valid chunks found for analysis")
            return None, []
        
        # Now analyze only the valid chunks
        for idx, i in enumerate(valid_chunks_idx):
            chunk_path = valid_chunk_paths[idx]
            logger.info(f"Analyzing valid chunk {idx+1}/{len(valid_chunk_paths)} (original idx: {i+1})")
            
            # Get the coordinates for context
            _, (left, top, right, bottom) = chunks[i]
            
            # Create a specialized prompt for this chunk
            if prompt:
                chunk_prompt = prompt
            else:
                chunk_prompt = CHUNK_ANALYSIS_PROMPT.format(
                    chunk_number=i+1,
                    total_chunks=len(chunk_paths),
                    coordinates=f"(left={left}, top={top}, right={right}, bottom={bottom})"
                )
            
            chunk_prompts.append(chunk_prompt)
            
            # Analyze the chunk
            analysis = analyze_image_with_ollama(chunk_path, chunk_prompt, progress_style)
            if analysis:
                chunk_analyses.append(analysis)
            else:
                logger.warning(f"Failed to analyze valid chunk {idx+1} (original idx: {i+1})")
        
        # Filter out any chunks that were skipped (had empty analysis)
        final_chunk_analyses = [analysis for analysis in chunk_analyses if analysis]
        
        if not final_chunk_analyses:
            logger.error("All chunk analyses failed or were blank")
            return None, []
            
        # If we only have one successful analysis, return it
        if len(final_chunk_analyses) == 1:
            return final_chunk_analyses[0], final_chunk_analyses
            
        # Combine the analyses
        logger.info(f"Combining {len(final_chunk_analyses)} non-blank chunk analyses")
        
        # Create a combined text with context about each chunk
        combined_text = f"Analysis of {len(final_chunk_analyses)} chunks from image: {os.path.basename(image_path)}\n\n"
        
        for i, analysis in enumerate(chunk_analyses):
            if not analysis:  # Skip blank chunks in the final output
                continue
            _, (left, top, right, bottom) = chunks[i]
            combined_text += f"--- CHUNK {i+1} (Coordinates: left={left}, top={top}, right={right}, bottom={bottom}) ---\n"
            combined_text += f"Prompt: {chunk_prompts[i][:100]}...\n"
            combined_text += analysis
            combined_text += "\n\n"
            
        # Summarize the combined analyses
        combine_prompt = CHUNK_COMBINE_PROMPT.format(num_chunks=len(final_chunk_analyses))
        
        logger.info("Generating final combined analysis")
        combined_analysis = summarize_text(combined_text, progress_style)
        
        if not combined_analysis:
            logger.warning("Failed to combine analyses, returning concatenated raw results")
            return combined_text, final_chunk_analyses
        
        logger.info("Successfully generated combined analysis from chunks")    
        return combined_analysis, final_chunk_analyses
        
    finally:
        # Clean up temporary files
        for chunk_path in chunk_paths:
            try:
                os.remove(chunk_path)
            except:
                pass
        
        try:
            os.rmdir(temp_dir)
        except:
            pass
