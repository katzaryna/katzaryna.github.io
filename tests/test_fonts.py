from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from scripts import fonts
from scripts.site_builder import SiteRepository


CSS = """/* cyrillic */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/v1/cyr.woff2) format('woff2');
  unicode-range: U+0400-045F;
}
/* latin-ext */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/v1/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/lora/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
"""
CATALOG = [
    {"family": "Lora", "category": "Serif", "fonts": ["400", "700"]},
    {"family": "Inter", "category": "Sans Serif", "fonts": ["400"]},
    {"family": "Buda", "category": "Display", "fonts": ["300"]},
    {"family": "Molle", "category": "Handwriting", "fonts": ["400i"]},
]


def make_site(root: Path, text_styles: dict | None = None) -> Path:
    (root / "_data").mkdir(parents=True)
    (root / "_data" / "text_places.yml").write_text(yaml.safe_dump([
        {"id": "title", "group": "G", "label": "Title", "selector": ".title", "font": "Inter", "font_size": 20, "align": "center"},
        {"id": "body", "group": "G", "label": "Body", "selector": ".body", "font": None, "font_size": 16},
    ]), encoding="utf-8")
    config = {"title": "Site", "exclude": ["site-builder"], "home_gallery": {"covers": []}}
    if text_styles:
        config["text_styles"] = text_styles
    (root / "_config.yml").write_text(yaml.safe_dump(config), encoding="utf-8")
    (root / "projects").mkdir()
    return root


@pytest.fixture
def fake_google(monkeypatch):
    requested = []

    def fetch(url: str) -> bytes:
        requested.append(url)
        if "css2" in url:
            return CSS.encode()
        return f"woff2 from {url}".encode()

    monkeypatch.setattr(fonts, "fetch", fetch)
    monkeypatch.setattr(fonts, "catalog", lambda cache_file: CATALOG)
    return requested


def test_css_query_asks_for_regular_or_closest_face() -> None:
    assert fonts.css_family_query("Tenor Sans", ["400"]) == "Tenor+Sans"
    assert fonts.css_family_query("Buda", ["300"]) == "Buda:wght@300"
    assert fonts.css_family_query("Molle", ["400i"]) == "Molle:ital,wght@1,400"


def test_only_latin_subsets_are_kept() -> None:
    faces = fonts.parse_font_css(CSS)
    assert [face["subset"] for face in faces] == ["latin-ext", "latin"]
    assert faces[1] == {
        "subset": "latin",
        "url": "https://fonts.gstatic.com/s/lora/v1/latin.woff2",
        "weight": 400,
        "style": "normal",
        "unicode_range": "U+0000-00FF",
    }


def test_install_downloads_into_its_own_folder_and_lists_the_font(tmp_path: Path, fake_google) -> None:
    root = make_site(tmp_path)

    entry = fonts.install(root, "Lora", CATALOG)

    assert entry["slug"] == "lora" and entry["fallback"] == "serif"
    assert sorted(path.name for path in (root / "assets/fonts/lora").iterdir()) == [
        "lora-400-latin-ext.woff2", "lora-400-latin.woff2",
    ]
    assert [font["family"] for font in fonts.load_fonts(root)] == ["Lora"]
    calls = len(fake_google)
    fonts.install(root, "Lora", CATALOG)
    assert len(fake_google) == calls  # already installed: nothing downloaded
    with pytest.raises(fonts.FontError, match="нет в Google Fonts"):
        fonts.install(root, "Comic Sans", CATALOG)


def test_prune_removes_unused_fonts_and_stray_files(tmp_path: Path, fake_google) -> None:
    root = make_site(tmp_path, {"body": {"font": "Lora"}})
    fonts.install(root, "Inter", CATALOG)
    fonts.install(root, "Lora", CATALOG)
    fonts.install(root, "Buda", CATALOG)
    (root / "assets/fonts/old-font.woff2").write_bytes(b"x")
    (root / "assets/fonts/lora/extra.woff2").write_bytes(b"x")
    assert set(fonts.check(root)) >= {
        "Font 'Buda' is installed but unused (python -m scripts.fonts prune).",
    }

    removed = fonts.prune(root)

    assert set(removed) == {"Buda", "buda", "old-font.woff2", "lora/extra.woff2"}
    assert [font["family"] for font in fonts.load_fonts(root)] == ["Inter", "Lora"]
    assert sorted(path.name for path in (root / "assets/fonts").iterdir()) == ["inter", "lora"]
    assert fonts.check(root) == []


def test_check_reports_used_but_missing_fonts(tmp_path: Path) -> None:
    root = make_site(tmp_path, {"body": {"font": "Lora"}, "gone": {"font_size": 3}})
    problems = fonts.check(root)
    assert "Font 'Inter' is used but not installed (python -m scripts.fonts install 'Inter')." in problems
    assert "Font 'Lora' is used but not installed (python -m scripts.fonts install 'Lora')." in problems
    assert any(problem.startswith("text_styles.gone") for problem in problems)


def test_builder_saves_text_styles_installs_and_prunes_fonts(tmp_path: Path, fake_google) -> None:
    root = make_site(tmp_path)
    fonts.install(root, "Inter", CATALOG)
    repository = SiteRepository(root)
    config = repository.read_config()

    config["text_styles"] = {"title": {"font": "Lora", "font_size": 24.0, "align": "right"}, "body": {"font": "", "font_size": ""}}
    state = repository.save_all(config, [])

    assert repository.read_config()["text_styles"] == {"title": {"font": "Lora", "font_size": 24, "align": "right"}}
    assert state["fonts"] == ["Lora"]  # Inter is no longer used anywhere
    assert fonts.check(root) == []

    config = repository.read_config()
    config.pop("text_styles")
    assert repository.save_all(config, [])["fonts"] == ["Inter"]
    assert not (root / "assets/fonts/lora").exists()


@pytest.mark.parametrize("style, message", [
    ({"nowhere": {"font_size": 12}}, "Unknown text place"),
    ({"body": {"align": "center"}}, "not available"),
    ({"title": {"align": "justify"}}, "not available"),
    ({"title": {"font_size": 4}}, "от 8 до 200"),
    ({"title": {"font_size": "big"}}, "must be a number"),
])
def test_builder_rejects_invalid_text_styles(tmp_path: Path, fake_google, style: dict, message: str) -> None:
    root = make_site(tmp_path)
    repository = SiteRepository(root)
    config = repository.read_config()
    config["text_styles"] = style
    with pytest.raises(ValueError, match=message):
        repository.save_all(config, [])
