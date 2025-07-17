"""Progress tracker for LLM token generation."""

import time
from typing import List, Tuple, Optional

from ..config.constants import TOKEN_RATE_WINDOW, ESTIMATED_TOKENS
from ..utils.terminal_utils import is_interactive_terminal

class ProgressTracker:
    """Base class for tracking progress of model generation."""
    def __init__(self, model_name: str, task_name: str, estimated_tokens: Optional[int] = None):
        """
        Initialize the progress tracker.
        
        Args:
            model_name: Name of the model being used
            task_name: Name of the task being performed
            estimated_tokens: Estimated total tokens for the task
        """
        self.model_name = model_name
        self.task_name = task_name
        self.start_time = time.time()
        self.last_update_time = self.start_time
        self.tokens_generated = 0
        self.total_tokens = estimated_tokens or ESTIMATED_TOKENS.get(model_name, 300)
        self.content = ""
        self.is_complete = False
        self.interactive = is_interactive_terminal()
        self.token_history: List[Tuple[float, int]] = []  # For calculating token rate
        
    def update(self, new_content: str):
        """
        Update progress with new content.
        
        Args:
            new_content: The new content to track
        """
        # Calculate new tokens
        new_tokens = len(new_content) - len(self.content)
        if new_tokens > 0:
            self.content = new_content
            self.tokens_generated += new_tokens
            current_time = time.time()
            
            # Store token generation time for rate calculation
            self.token_history.append((current_time, new_tokens))
            
            # Clean up history older than the window
            while self.token_history and self.token_history[0][0] < current_time - TOKEN_RATE_WINDOW:
                self.token_history.pop(0)
                
            self.last_update_time = current_time
    
    def get_token_rate(self) -> float:
        """
        Calculate tokens per second over the recent window.
        
        Returns:
            float: Token generation rate in tokens per second
        """
        if not self.token_history:
            return 0.0
        
        oldest_time = self.token_history[0][0]
        newest_time = self.token_history[-1][0]
        time_diff = newest_time - oldest_time
        
        if time_diff < 0.1:  # Avoid division by very small numbers
            return 0.0
            
        total_tokens = sum(tokens for _, tokens in self.token_history)
        return total_tokens / time_diff
        
    def get_progress_percentage(self) -> int:
        """
        Get the estimated progress percentage.
        
        Returns:
            int: Progress percentage (0-100)
        """
        return min(100, int(100 * self.tokens_generated / self.total_tokens))
        
    def get_elapsed_time(self) -> float:
        """
        Get the elapsed time in seconds.
        
        Returns:
            float: Elapsed time in seconds
        """
        return time.time() - self.start_time
        
    def get_estimated_remaining(self) -> Optional[float]:
        """
        Estimate remaining time based on current rate.
        
        Returns:
            Optional[float]: Estimated remaining time in seconds, or None if can't estimate
        """
        if self.is_complete:
            return 0.0
            
        rate = self.get_token_rate()
        if rate <= 0:
            return None  # Can't estimate
            
        remaining_tokens = self.total_tokens - self.tokens_generated
        return remaining_tokens / rate
        
    def format_time(self, seconds) -> str:
        """
        Format seconds as mm:ss.
        
        Args:
            seconds: Number of seconds to format
            
        Returns:
            str: Formatted time string
        """
        if seconds is None:
            return "??:??"
        return f"{int(seconds) // 60:02d}:{int(seconds) % 60:02d}"
        
    def complete(self):
        """Mark the progress as complete."""
        self.is_complete = True
