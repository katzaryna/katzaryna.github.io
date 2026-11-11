from __future__ import annotations

from pathlib import Path
import re

import pytest
import yaml

from scripts.site_builder import SiteRepository


ROOT = Path(__file__).parent.parent
COLORS = yaml.safe_load((ROOT / "_data" / "colors.yml").read_text(encoding="utf-8"))
PLACES = yaml.safe_load((ROOT / "_data" / "text_places.yml").read_text(encoding="utf-8"))
STYLES = (ROOT / "assets" / "css" / "styles.css").read_text(encoding="utf-8")


def short_hex(color: str) -> str:
    """#ffffff -> #fff when possible, as stylelint prefers in styles.css."""
    digits = color.lower().lstrip("#")
    if all(digits[index] == digits[index + 1] for index in range(0, 6, 2)):
        return "#" + digits[::2]
    return "#" + digits


@pytest.mark.parametrize("setting", COLORS, ids=lambda setting: setting["id"])
def test_colour_defaults_match_the_stylesheet(setting: dict) -> None:
    root_block = STYLES[STYLES.index(":root {"):STYLES.index("}", STYLES.index(":root {"))]
    declared = re.search(rf"{re.escape(setting['variable'])}:\s*([^;]+);", root_block)
    assert declared, f"{setting['variable']} is not declared in :root"
    if "opacity" in setting:
        expected = f"color-mix(in srgb, {short_hex(setting['color'])} {setting['opacity']}%, transparent)"
    else:
        expected = short_hex(setting["color"])
    assert declared.group(1).strip().lower() == expected


@pytest.mark.parametrize("place", PLACES, ids=lambda place: place["id"])
def test_text_place_selectors_exist_on_the_site(place: dict) -> None:
    sources = "".join(
        path.read_text(encoding="utf-8")
        for pattern in ("*.html", "_includes/*.html", "_layouts/*.html", "assets/js/*.js")
        for path in ROOT.glob(pattern)
    )
    for class_name in re.findall(r"\.([\w-]+)", place["selector"]):
        assert class_name in sources, f"{place['id']}: .{class_name} is not used in any template or script"


def make_site(root: Path) -> SiteRepository:
    (root / "_data").mkdir(parents=True)
    (root / "_data" / "colors.yml").write_text(yaml.safe_dump(COLORS, allow_unicode=True), encoding="utf-8")
    (root / "_config.yml").write_text(yaml.safe_dump({
        "exclude": ["site-builder"], "home_gallery": {"covers": []},
    }), encoding="utf-8")
    (root / "projects").mkdir()
    return SiteRepository(root)


def test_colours_are_validated_and_tidied(tmp_path: Path) -> None:
    repository = make_site(tmp_path)
    config = repository.read_config()
    config["colors"] = {
        "background": {"color": "#FAF7F0"},
        "hover_overlay": {"color": "#112233", "opacity": 35.4},
        "text": {"color": "", "opacity": None},
    }

    state = repository.save_all(config, [])

    assert repository.read_config()["colors"] == {
        "background": {"color": "#faf7f0"},
        "hover_overlay": {"color": "#112233", "opacity": 35},
    }
    assert [setting["id"] for setting in state["color_settings"]][:2] == ["background", "text"]


@pytest.mark.parametrize("colors, message", [
    ({"nowhere": {"color": "#000000"}}, "Unknown colour"),
    ({"text": {"color": "red"}}, "#rrggbb"),
    ({"text": {"opacity": 50}}, "not available"),
    ({"hover_overlay": {"opacity": 150}}, "от 0 до 100"),
])
def test_invalid_colours_are_rejected(tmp_path: Path, colors: dict, message: str) -> None:
    repository = make_site(tmp_path)
    config = repository.read_config()
    config["colors"] = colors
    with pytest.raises(ValueError, match=message):
        repository.save_all(config, [])
