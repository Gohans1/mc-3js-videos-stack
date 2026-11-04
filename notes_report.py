"""Reads this film's notes with the studio's report: python notes_report.py [ID ...] [--shot N]"""
import os
import runpy
from pathlib import Path

os.chdir(Path(__file__).resolve().parent)
runpy.run_path("node_modules/live-studio/notes_report.py", run_name="__main__")
