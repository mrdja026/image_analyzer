"""Logging utilities for the image analyzer package."""

import os
import logging
from logging.handlers import RotatingFileHandler
from typing import Optional, Union
from ..config.constants import LOG_DIR

def setup_logger(name: str, log_file: Optional[str] = None, level: Union[int, str] = logging.INFO):
    """
    Set up a logger with file and console handlers.
    
    Args:
        name: Logger name
        log_file: Optional path to log file
        level: Logging level (can be int or string like 'DEBUG', 'INFO', etc.)
        
    Returns:
        logger: Configured logger instance
    """
    # Convert string level to int if needed
    if isinstance(level, str):
        level = getattr(logging, level.upper())
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # Clear any existing handlers
    if logger.hasHandlers():
        logger.handlers.clear()
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # File handler with rotation (optional)
    if log_file:
        try:
            # Ensure log directory exists
            os.makedirs(os.path.dirname(log_file), exist_ok=True)
            
            file_handler = RotatingFileHandler(
                log_file, maxBytes=10*1024*1024, backupCount=5
            )
            file_handler.setFormatter(formatter)
            logger.addHandler(file_handler)
        except IOError as e:
            logger.warning(f"Could not set up log file: {e}")
    
    return logger

# Create logs directory if it doesn't exist
os.makedirs(LOG_DIR, exist_ok=True)

# Create a default logger instance
_default_logger = setup_logger("ImageAnalyzer", os.path.join(LOG_DIR, "image_analyzer.log"))

def get_logger():
    """Get the default logger instance."""
    return _default_logger
