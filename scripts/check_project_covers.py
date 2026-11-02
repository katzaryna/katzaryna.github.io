#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "projects"
FRONT_MATTER = re.compile(r"\A---\s*\n(.*?)\n---(?:\s*\n|\Z)", re.DOTALL)
MAX_COVER_ORDER = 9_999_999_999


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


def cover_order_errors(
    metadata: object,
    seen_orders: dict[int, Path],
    project_file: Path,
) -> list[str]:
    if not isinstance(metadata, dict):
        return []

    images = metadata.get("images")
    if not isinstance(images, list):
        return []

    errors = []
    for image in images:
        if not isinstance(image, dict) or image.get("cover") is not True:
            continue

        order = image.get("gallery_order")
        filename = image.get("file", "<missing file>")
        location = f"{project_file}: image {filename}"
        if (
            isinstance(order, bool)
            or not isinstance(order, int)
            or order <= 0
            or order > MAX_COVER_ORDER
        ):
            errors.append(f"{location} must have a positive integer `gallery_order`.")
            continue
        if order in seen_orders:
            previous = seen_orders[order]
            errors.append(
                f"{location} duplicates `gallery_order: {order}` from {previous}."
            )
        else:
            seen_orders[order] = project_file
    return errors


def main() -> int:
    errors = []
    seen_orders = {}
    for project_file in sorted(PROJECTS.glob("*/index.md")):
        content = project_file.read_text(encoding="utf-8")
        match = FRONT_MATTER.match(content)
        if not match:
            raise ValueError(f"{project_file}: missing YAML front matter")

        metadata = yaml.safe_load(match.group(1))
        errors.extend(
            cover_order_errors(
                metadata,
                seen_orders,
                project_file.relative_to(ROOT),
            )
        )
        if not has_selected_cover(metadata):
            print(
                f"WARNING: {project_file.relative_to(ROOT)} has no selected cover. "
                "Mark an entry in `images` with `cover: true`.",
                file=sys.stderr,
            )

    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
