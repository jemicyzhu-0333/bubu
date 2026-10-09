#!/usr/bin/env python3
"""Rebuild this preserved prototype: python build_prototype.py --output NEWDIR."""
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parent
ENTRY = SOURCE.parents[5] / 'tools/usagi-wardrobe/generation/build_depth_prototype.py'

if __name__ == '__main__':
    builder = runpy.run_path(str(ENTRY))
    raise SystemExit(builder['main'](default_source=SOURCE))
