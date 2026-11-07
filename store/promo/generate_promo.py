#!/usr/bin/env python3
"""Regenerate final promo images together with the actual extension screenshots."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[1]/'tools/render_assets.py'), run_name='__main__')
