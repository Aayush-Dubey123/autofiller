"""
Logger module for AutoFiller backend.

Configures formatted process logging adhering to Eigi backend engineering standards.
"""

import logging
import os
import sys


def logger(name: str = "autofiller") -> logging.Logger:
    """
    Create or retrieve a configured logger instance.

    Sets up a stream handler with standardized formatting and prevents duplicate propagation.

    Args:
        name (str): Name of the logger, typically __name__. Defaults to 'autofiller'.

    Returns:
        logging.Logger: Configured standard logger.

    Raises:
        None
    """
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    instance = logging.getLogger(name)
    instance.setLevel(getattr(logging, log_level, logging.INFO))

    if not instance.handlers:
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(logging.Formatter(log_format))
        instance.addHandler(stream_handler)

    instance.propagate = False
    return instance
