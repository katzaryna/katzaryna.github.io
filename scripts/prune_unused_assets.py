#!/usr/bin/env python3
"""Remove project images that no project page references from the built site."""
from __future__ import annotations

import argparse
from pathlib import Path

from scripts.project_files import PROJECTS, unreferenced_images


def prune(site_dir: Path, projects_dir: Path = PROJECTS) -> list[Path]:
    removed = []
    for project_directory in sorted(path for path in projects_dir.iterdir() if path.is_dir()):
        for source in unreferenced_images(project_directory):
            built = site_dir / "projects" / project_directory.name / source.name
            if built.is_file():
                built.unlink()
                removed.append(built)
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", type=Path, default=Path("_site"))
    site_dir = parser.parse_args().site_dir
    if not site_dir.is_dir():
        parser.error(f"site directory does not exist: {site_dir}")
    removed = prune(site_dir)
    print(f"Removed {len(removed)} unreferenced project images from {site_dir}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
