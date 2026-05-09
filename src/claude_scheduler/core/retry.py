"""Retry engine with exponential backoff."""
import time
from pathlib import Path
from .models import Task
from .executor import execute_task


def run_with_retry(task: Task, logs_dir: Path, db=None) -> dict:
    # Total attempts = initial attempt + configured retries
    max_attempts = 1 + task.retry
    last_result = None

    for attempt in range(1, max_attempts + 1):
        result = execute_task(task, logs_dir, attempt=attempt, db=db)
        result["attempt"] = attempt

        if result["status"] == "success":
            return result

        last_result = result

        # Sleep between attempts, not after the final one
        if attempt < max_attempts:
            delay = task.retry_delay * (2 ** (attempt - 1))
            time.sleep(delay)

    return last_result
