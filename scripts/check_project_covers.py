#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

from scripts.project_files import unreferenced_images


ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "projects"
FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---(?:\s*\n|\Z)", re.DOTALL)


def has_selected_cover(metadata: object) -> bool:
    if not isinstance(metadata, dict):
        return False

    images = metadata.get("images")
    return isinstance(images, list) and any(
        isinstance(image, dict)
        and image.get("cover") is True
        and isinstance(image.get("file"), str)
        and image["file"].strip()
        for image in images
    )


def main() -> int:
    for project_file in sorted(PROJECTS.glob("*/index.md")):
        content = project_file.read_text(encoding="utf-8")
        match = FRONT_MATTER.match(content)
        if not match:
            raise ValueError(f"{project_file}: missing YAML front matter")

        metadata = yaml.safe_load(match.group(1))
        unused = unreferenced_images(project_file.parent)
        if unused:
            print(
                f"WARNING: {project_file.parent.relative_to(ROOT)} has images not listed in `images` "
                f"(not published): {', '.join(path.name for path in unused)}",
                file=sys.stderr,
            )
        if not has_selected_cover(metadata):
            print(
                f"WARNING: {project_file.relative_to(ROOT)} has no selected cover. "
                "Mark an entry in `images` with `cover: true`.",
                file=sys.stderr,
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
