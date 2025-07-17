"""Terminal utilities for the image analyzer package."""

import sys
import shutil

def is_interactive_terminal():
    """
    Check if the script is running in an interactive terminal that supports cursor control.
    
    Returns:
        bool: True if running in an interactive terminal, False otherwise
    """
    return sys.stdout.isatty()

def get_terminal_size():
    """
    Get the current terminal size.
    
    Returns:
        tuple: (width, height) of the terminal
    """
    try:
        columns, rows = shutil.get_terminal_size()
        return columns, rows
    except (AttributeError, OSError):
        return 80, 24  # Default fallback size
