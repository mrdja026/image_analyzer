"""Progress display classes for showing progress of LLM token generation."""

import sys
import time
from typing import Optional, Union

from .progress_tracker import ProgressTracker
from ..config.constants import (
    PROGRESS_REFRESH_RATE, 
    SPINNER_CHARS, 
    PROGRESS_BAR_LENGTH
)
from ..utils.terminal_utils import get_terminal_size

class SimpleProgressDisplay:
    """Simple text-based progress display for token generation."""
    def __init__(self, tracker: ProgressTracker):
        """
        Initialize the simple progress display.
        
        Args:
            tracker: Progress tracker instance
        """
        self.tracker = tracker
        self.last_display_time = time.time()
        
    def update_display(self):
        """Update the progress display."""
        if not self.tracker.interactive or time.time() - self.last_display_time < PROGRESS_REFRESH_RATE:
            return
            
        self.last_display_time = time.time()
        progress = self.tracker.get_progress_percentage()
        elapsed = self.tracker.get_elapsed_time()
        remaining = self.tracker.get_estimated_remaining()
        rate = self.tracker.get_token_rate()
        
        status = f"\r{self.tracker.task_name}: {progress}% complete | "
        status += f"Rate: {rate:.1f} tok/s | "
        status += f"Time: {self.tracker.format_time(elapsed)} "
        
        if remaining is not None:
            status += f"| ETA: {self.tracker.format_time(remaining)}"
            
        # Get terminal width to avoid line wrapping
        term_width, _ = get_terminal_size()
        if len(status) > term_width - 1:
            status = status[:term_width - 4] + "..."
            
        sys.stdout.write(status)
        sys.stdout.flush()
        
    def complete(self):
        """Complete the progress display."""
        if self.tracker.interactive:
            progress = 100
            elapsed = self.tracker.get_elapsed_time()
            rate = self.tracker.get_token_rate()
            
            status = f"\r{self.tracker.task_name}: {progress}% complete | "
            status += f"Rate: {rate:.1f} tok/s | "
            status += f"Time: {self.tracker.format_time(elapsed)}     \n"
            
            sys.stdout.write(status)
            sys.stdout.flush()

class ProgressBarDisplay:
    """Progress bar display for token generation."""
    def __init__(self, tracker: ProgressTracker):
        """
        Initialize the progress bar display.
        
        Args:
            tracker: Progress tracker instance
        """
        self.tracker = tracker
        self.last_display_time = time.time()
        
    def update_display(self):
        """Update the progress display with a visual bar."""
        if not self.tracker.interactive or time.time() - self.last_display_time < PROGRESS_REFRESH_RATE:
            return
            
        self.last_display_time = time.time()
        progress = self.tracker.get_progress_percentage()
        elapsed = self.tracker.get_elapsed_time()
        remaining = self.tracker.get_estimated_remaining()
        
        # Calculate bar width based on terminal size
        term_width, _ = get_terminal_size()
        max_bar_width = min(PROGRESS_BAR_LENGTH, term_width - 30)  # Reserve space for text
        bar_width = max(10, max_bar_width)
        
        # Create the progress bar
        filled_length = int(bar_width * progress // 100)
        bar = '█' * filled_length + '░' * (bar_width - filled_length)
        
        status = f"\r{self.tracker.task_name} [{bar}] {progress}% | "
        status += f"{self.tracker.format_time(elapsed)}"
        
        if remaining is not None:
            status += f" ETA: {self.tracker.format_time(remaining)}"
            
        if len(status) > term_width - 1:
            status = status[:term_width - 4] + "..."
            
        sys.stdout.write(status)
        sys.stdout.flush()
        
    def complete(self):
        """Complete the progress display."""
        if self.tracker.interactive:
            bar = '█' * PROGRESS_BAR_LENGTH
            elapsed = self.tracker.get_elapsed_time()
            
            status = f"\r{self.tracker.task_name} [{bar}] 100% | "
            status += f"{self.tracker.format_time(elapsed)}        \n"
            
            sys.stdout.write(status)
            sys.stdout.flush()

class SpinnerProgressDisplay:
    """Spinner animation for token generation progress."""
    def __init__(self, tracker: ProgressTracker):
        """
        Initialize the spinner progress display.
        
        Args:
            tracker: Progress tracker instance
        """
        self.tracker = tracker
        self.last_display_time = time.time()
        self.spinner_idx = 0
        
    def update_display(self):
        """Update the progress display with a spinner animation."""
        if not self.tracker.interactive or time.time() - self.last_display_time < PROGRESS_REFRESH_RATE:
            return
            
        self.last_display_time = time.time()
        elapsed = self.tracker.get_elapsed_time()
        rate = self.tracker.get_token_rate()
        
        # Update spinner character
        spinner = SPINNER_CHARS[self.spinner_idx]
        self.spinner_idx = (self.spinner_idx + 1) % len(SPINNER_CHARS)
        
        status = f"\r{spinner} {self.tracker.task_name} | "
        status += f"{self.tracker.tokens_generated} tokens | "
        status += f"{rate:.1f} tok/s | "
        status += f"{self.tracker.format_time(elapsed)}"
        
        # Get terminal width
        term_width, _ = get_terminal_size()
        if len(status) > term_width - 1:
            status = status[:term_width - 4] + "..."
            
        sys.stdout.write(status)
        sys.stdout.flush()
        
    def complete(self):
        """Complete the progress display."""
        if self.tracker.interactive:
            elapsed = self.tracker.get_elapsed_time()
            tokens = self.tracker.tokens_generated
            
            status = f"\r✓ {self.tracker.task_name} complete | "
            status += f"{tokens} tokens | "
            status += f"{self.tracker.format_time(elapsed)}        \n"
            
            sys.stdout.write(status)
            sys.stdout.flush()

def create_progress_display(style: str, tracker: ProgressTracker) -> Optional[Union[SimpleProgressDisplay, ProgressBarDisplay, SpinnerProgressDisplay]]:
    """
    Create the appropriate progress display based on style.
    
    Args:
        style: Style of progress display ('simple', 'bar', 'spinner', 'none')
        tracker: Progress tracker instance
        
    Returns:
        Progress display instance or None if display is disabled
    """
    if not tracker.interactive or style == "none":
        return None
        
    if style == "bar":
        return ProgressBarDisplay(tracker)
    elif style == "spinner":
        return SpinnerProgressDisplay(tracker)
    else:  # Default to simple
        return SimpleProgressDisplay(tracker)
