"""Trusted isolated-mode launcher for a learner-visible Parrot main.py."""

import runpy
import sys
from pathlib import Path

runtime_directory = str(Path(__file__).resolve().parent)
sys.path.insert(0, runtime_directory)
runpy.run_path(sys.argv[1], run_name="__main__")
