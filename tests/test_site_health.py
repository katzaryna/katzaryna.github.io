import json
from pathlib import Path

from PIL import Image

from scripts import site_health


def write_site(root: Path, project_text: str, extra_config: str = "") -> None:
    (root / "projects" / "art").mkdir(parents=True)
    (root / "_config.yml").write_text(
        "url: https://example.org\ndescription: Short description.\nartist:\n  full_name: Ann Artist\n"
        "search_console:\n  verification: CODE123\n" + extra_config,
        encoding="utf-8",
    )
    (root / "projects" / "art" / "index.md").write_text(project_text, encoding="utf-8")


def by_id(result: dict) -> dict:
    return {item["id"]: item for item in result["checks"]}


def test_a_tidy_site_has_nothing_to_fix(tmp_path: Path) -> None:
    write_site(tmp_path, "---\ntitle: Art\ndescription: A project.\nimages:\n"
                         "- file: a.png\n  alt: A\n  caption: Morning\n  description: Light.\n---\nText.\n")
    Image.new("RGB", (4, 4)).save(tmp_path / "projects" / "art" / "a.png")

    result = site_health.content_checks(tmp_path)

    assert result["warnings"] == 0
    assert all(item["level"] == "ok" for item in result["checks"])


def test_problems_are_found_and_point_to_the_project(tmp_path: Path) -> None:
    long_description = "x" * 170
    write_site(tmp_path, f"---\ntitle: Art\ndescription: {long_description}\nimages:\n"
                         "- file: a.png\n  alt: A\n  caption: Morning\n"
                         "- file: b.png\n  alt: B\n  caption: Morning!\n---\n", extra_config="")
    for name in ("a.png", "b.png", "spare.png"):
        Image.new("RGB", (4, 4)).save(tmp_path / "projects" / "art" / name)
    (tmp_path / "projects" / "art" / "a.png").write_bytes(b"0" * (site_health.HEAVY_IMAGE_BYTES + 1))
    config = (tmp_path / "_config.yml").read_text().replace("search_console:\n  verification: CODE123\n", "")
    (tmp_path / "_config.yml").write_text(config)

    checks = by_id(site_health.content_checks(tmp_path))

    assert checks["unlisted"]["items"] == [{"slug": "art", "anchor": "unlisted", "count": 1, "text": "«Art»: spare.png"}]
    assert "длиннее 160 символов (170)" in checks["texts"]["items"][0]["text"]
    assert "нет текста на странице" in checks["texts"]["items"][0]["text"]
    assert "без описания — 2" in checks["captions"]["items"][0]["text"]
    assert "#morning" in checks["addresses"]["items"][0]["text"]
    assert "a.png — 5,0 МБ" in checks["heavy"]["items"][0]["text"]
    assert checks["settings"]["items"] == [{"view": "advanced", "text": "Нет кода Google Search Console («Дополнительно»)"}]
    assert checks["texts"]["summary"] == "Не хватает текстов в 1 проекте — по ним ищут и их показывают в превью ссылок."


def test_artwork_addresses_match_the_site() -> None:
    assert site_health.artwork_address("Cedar, bottle and box") == "cedar-bottle-and-box"
    assert site_health.artwork_address("Thank you for watching") == "thank-you-for-watching"
    assert site_health.artwork_address("img_3035 copy") == "img-3035-copy"


def fake_site(pages: dict[str, tuple[int, str]]):
    calls = []

    def fetch(url: str, timeout: float) -> tuple[int, str]:
        calls.append(url)
        if url.startswith(site_health.PAGESPEED_API):
            strategy = "mobile" if "strategy=mobile" in url else "desktop"
            return 200, json.dumps({"lighthouseResult": {
                "categories": {"performance": {"score": 0.98 if strategy == "mobile" else 1},
                               "accessibility": {"score": 1}, "best-practices": {"score": 1}, "seo": {"score": 0.92}},
                "audits": {"largest-contentful-paint": {"displayValue": "2.5 s"},
                           "cumulative-layout-shift": {"displayValue": "0"}},
            }})
        path = url.removeprefix("https://example.org/")
        if path.startswith("no-such-page-"):
            return pages.get("missing", (404, "This page could not be found"))
        return pages.get(path, (404, ""))

    return fetch, calls


def test_live_checks_read_the_site_and_pagespeed(tmp_path: Path) -> None:
    write_site(tmp_path, "---\ntitle: Art\n---\n")
    fetch, calls = fake_site({
        "": (200, '<meta name="google-site-verification" content="CODE123">'),
        "sitemap.xml": (200, "<loc>a</loc><loc>b</loc><image:loc>c</image:loc>"),
        "robots.txt": (200, "Content-Signal: search=yes, ai-input=yes, ai-train=no\nSitemap: x"),
        ".well-known/tdmrep.json": (200, '[{"location": "/", "tdm-reservation": 1}]'),
    })

    result = site_health.live_checks(tmp_path, fetch)

    assert [item["ok"] for item in result["addresses"]] == [True] * 5
    assert result["addresses"][1]["detail"] == "2 страницы, 1 работа"
    assert result["speed"]["mobile"] == {"performance": 98, "accessibility": 100, "best_practices": 100,
                                         "seo": 92, "lcp": "2.5 s", "cls": "0"}
    assert result["speed"]["desktop"]["performance"] == 100
    assert result["report_url"] == "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fexample.org%2F"
    assert site_health.last_live_checks(tmp_path) == result
    assert any("strategy=desktop" in url and "category=SEO" in url for url in calls)


def test_live_checks_explain_what_is_missing(tmp_path: Path) -> None:
    write_site(tmp_path, "---\ntitle: Art\n---\n")
    fetch, _ = fake_site({"": (200, "<html>no code yet</html>"), "missing": (404, "GitHub default page")})

    result = site_health.live_checks(tmp_path, fetch)
    home, sitemap, robots, tdmrep, not_found = result["addresses"]

    assert not home["ok"] and "кода Search Console на ней нет" in home["detail"]
    assert not sitemap["ok"] and not robots["ok"] and not tdmrep["ok"]
    assert not not_found["ok"]


def test_pagespeed_errors_are_explained() -> None:
    assert "лимит" in site_health.pagespeed("https://example.org/", "mobile", lambda url, timeout: (429, ""))["error"]
    broken = site_health.pagespeed("https://example.org/", "mobile",
                                   lambda url, timeout: (400, json.dumps({"error": {"message": "Bad URL"}})))
    assert broken == {"error": "Google PageSpeed: Bad URL"}

    def offline(url, timeout):
        raise OSError("no network")

    assert "не ответил" in site_health.pagespeed("https://example.org/", "mobile", offline)["error"]


def test_pagespeed_key_is_kept_locally_and_used(tmp_path: Path) -> None:
    key = "AIzaSyA1234567890abcdefghijklmnopqrstu"
    assert site_health.read_pagespeed_key(tmp_path) == ""
    assert site_health.save_pagespeed_key(tmp_path, f"  {key} ")
    assert site_health.read_pagespeed_key(tmp_path) == key
    assert oct((tmp_path / site_health.PAGESPEED_KEY_FILE).stat().st_mode)[-3:] == "600"

    urls = []
    site_health.pagespeed("https://example.org/", "mobile", lambda url, timeout: (urls.append(url), (429, ""))[1], key)
    assert f"key={key}" in urls[0]

    import pytest
    with pytest.raises(ValueError):
        site_health.save_pagespeed_key(tmp_path, "not a key")
    assert not site_health.save_pagespeed_key(tmp_path, "")
    assert site_health.read_pagespeed_key(tmp_path) == ""


def test_quota_without_key_suggests_one() -> None:
    result = site_health.pagespeed("https://example.org/", "mobile", lambda url, timeout: (429, ""))
    assert result["quota"] and "свой бесплатный ключ" in result["error"]
