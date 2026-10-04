#!/usr/bin/env python3
from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class SiteValidator(HTMLParser):
    def __init__(self, html_path: Path, site_dir: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.html_path = html_path
        self.site_dir = site_dir
        self.errors = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        decorative_image = (
            attributes.get("aria-hidden", "").lower() == "true"
            or attributes.get("role", "").lower() in {"none", "presentation"}
        )
        if tag == "img" and not (attributes.get("alt") or "").strip() and not decorative_image:
            self.errors.append(f"{self.html_path}: image is missing a non-empty alt attribute")

        for name in ("href", "src", "poster"):
            value = attributes.get(name)
            if value:
                self._check_local_url(value)

        srcset = attributes.get("srcset", "")
        for candidate in srcset.split(","):
            url = candidate.strip().split(maxsplit=1)
            if url:
                self._check_local_url(url[0])

    def _check_local_url(self, value: str) -> None:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or not parsed.path:
            return

        path = Path(unquote(parsed.path.lstrip("/"))) if parsed.path.startswith("/") else (
            self.html_path.parent / unquote(parsed.path)
        )
        target = (self.site_dir / path).resolve() if parsed.path.startswith("/") else path.resolve()
        if not target.is_relative_to(self.site_dir.resolve()):
            self.errors.append(f"{self.html_path}: local URL escapes the site directory: {value}")
        elif target.is_dir():
            if not (target / "index.html").is_file():
                self.errors.append(f"{self.html_path}: broken local URL: {value}")
        elif not target.is_file():
            self.errors.append(f"{self.html_path}: broken local URL: {value}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check built HTML for missing alt text and broken local links.")
    parser.add_argument("--site-dir", type=Path, default=Path("_site"))
    site_dir = parser.parse_args().site_dir.resolve()
    if not site_dir.is_dir():
        parser.error(f"site directory does not exist: {site_dir}")

    errors = []
    html_files = sorted(site_dir.rglob("*.html"))
    for html_path in html_files:
        validator = SiteValidator(html_path, site_dir)
        validator.feed(html_path.read_text(encoding="utf-8"))
        errors.extend(validator.errors)

    if errors:
        print("\n".join(errors))
        return 1

    print(f"Validated {len(html_files)} HTML files: all images have alt text and local URLs resolve.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
