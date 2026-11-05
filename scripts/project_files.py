#!/usr/bin/env python3
"""Shared helpers for finding which project files are referenced by front matter."""
from __future__ import annotations

import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "projects"
FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---(?:\s*\n|\Z)", re.DOTALL)
IMAGE_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".webp"}


def read_metadata(project_file: Path) -> object:
    match = FRONT_MATTER.match(project_file.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"{project_file}: missing YAML front matter")
    return yaml.safe_load(match.group(1))


def referenced_files(metadata: object) -> set[str]:
    if not isinstance(metadata, dict) or not isinstance(metadata.get("images"), list):
        return set()
    return {
        image["file"]
        for image in metadata["images"]
        if isinstance(image, dict) and isinstance(image.get("file"), str)
    }


def unreferenced_images(project_directory: Path) -> list[Path]:
    """Image files in a project directory that its index.md does not list in `images`."""
    project_file = project_directory / "index.md"
    if not project_file.is_file():
        return []
    used = referenced_files(read_metadata(project_file))
    return sorted(
        path for path in project_directory.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES and path.name not in used
    )
