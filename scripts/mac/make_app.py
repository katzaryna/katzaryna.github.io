#!/usr/bin/env python3
"""Create the "Мой сайт" app that opens the site builder, and put it in the Dock.

The app only calls scripts/mac/launch.sh from the repository, so updates to the
launcher arrive with ordinary git pulls and the app never needs rebuilding.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import plistlib
import shlex
import subprocess
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont


FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/System/Library/Fonts/Times.ttc",
)


def draw_icon(size: int = 1024) -> Image.Image:
    """The builder's brand mark: a white serif K on a dark circle."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = size // 10
    draw.ellipse((margin, margin, size - margin, size - margin), fill=(35, 35, 33, 255))
    font_path = next((path for path in FONT_CANDIDATES if Path(path).is_file()), None)
    font = ImageFont.truetype(font_path, int(size * 0.5)) if font_path else ImageFont.load_default(int(size * 0.5))
    draw.text((size / 2, size / 2), "K", font=font, fill="white", anchor="mm")
    return image


def make_app(site: Path, applications: Path, name: str) -> Path:
    app = applications / f"{name}.app"
    contents = app / "Contents"
    (contents / "MacOS").mkdir(parents=True, exist_ok=True)
    (contents / "Resources").mkdir(parents=True, exist_ok=True)
    launcher = contents / "MacOS" / "launch"
    launcher.write_text(
        "#!/bin/bash\n"
        f"exec /bin/bash {shlex.quote(str(site / 'scripts' / 'mac' / 'launch.sh'))}\n",
        encoding="utf-8",
    )
    launcher.chmod(0o755)
    draw_icon().save(contents / "Resources" / "icon.icns")
    with (contents / "Info.plist").open("wb") as plist:
        plistlib.dump({
            "CFBundleName": name,
            "CFBundleDisplayName": name,
            "CFBundleIdentifier": "io.github.katzaryna.site-builder",
            "CFBundleExecutable": "launch",
            "CFBundleIconFile": "icon",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": "1.0",
            "LSMinimumSystemVersion": "11.0",
        }, plist)
    # Make Finder and the Dock pick up the new icon.
    subprocess.run(["touch", str(app)], check=False)
    return app


def add_to_dock(app: Path) -> None:
    url = "file://" + quote(f"{app}/")
    current = subprocess.run(
        ["defaults", "read", "com.apple.dock", "persistent-apps"], capture_output=True, text=True, check=False
    ).stdout
    if url in current or str(app) in current:
        return
    tile = (
        "<dict><key>tile-data</key><dict><key>file-data</key><dict>"
        f"<key>_CFURLString</key><string>{url}</string>"
        "<key>_CFURLStringType</key><integer>15</integer>"
        "</dict></dict></dict>"
    )
    subprocess.run(["defaults", "write", "com.apple.dock", "persistent-apps", "-array-add", tile], check=True)
    subprocess.run(["killall", "Dock"], check=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--applications", type=Path, default=Path.home() / "Applications")
    parser.add_argument("--name", default="Мой сайт")
    parser.add_argument("--no-dock", action="store_true")
    arguments = parser.parse_args()
    app = make_app(arguments.site.resolve(), arguments.applications, arguments.name)
    if not arguments.no_dock:
        add_to_dock(app)
    print(app)


if __name__ == "__main__":
    main()
