#!/usr/bin/env python3
"""Site health for the builder's «Состояние сайта» tab.

content_checks() looks at the repository on this computer (instant): files
that are not on the site, missing or too long texts, repeated artwork
addresses, heavy originals and site settings. live_checks() looks at the
published site (on request, about a minute): its key addresses, and speed,
accessibility, practices and SEO from Google PageSpeed Insights.

Messages are in plain Russian, for the site owner.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
import uuid

import yaml

from scripts.change_summary import plural
from scripts.project_files import FRONT_MATTER, unreferenced_images


SNIPPET_LIMIT = 160
HEAVY_IMAGE_BYTES = 5 * 1024 * 1024
HEAVY_ANIMATION_BYTES = 10 * 1024 * 1024
LIVE_RESULT_FILE = Path(".builder-cache") / "health-live.json"
# A Google API key for PageSpeed Insights, kept on this computer only: without
# one, requests share Google's anonymous daily quota, which is often used up.
PAGESPEED_KEY_FILE = Path(".builder-cache") / "pagespeed-key.txt"
PAGESPEED_KEY = re.compile(r"[A-Za-z0-9_-]{30,60}")
PAGESPEED_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
PAGESPEED_CATEGORIES = ("PERFORMANCE", "ACCESSIBILITY", "BEST_PRACTICES", "SEO")
USER_AGENT = "site-builder-health-check"
FETCH_TIMEOUT = 20
PAGESPEED_TIMEOUT = 150

# Callable(url, timeout) -> (status, body text); replaceable in tests.
Fetch = Callable[[str, float], tuple[int, str]]


def artwork_address(text: str) -> str:
    """The #address an artwork gets on the site, as Jekyll's slugify makes it."""
    return re.sub(r"[^\w]+|_+", "-", text.lower()).strip("-")


def megabytes(size: int) -> str:
    return f"{size / 1024 / 1024:.1f} МБ".replace(".", ",")


def read_project(project_file: Path) -> tuple[dict, str]:
    text = project_file.read_text(encoding="utf-8")
    match = FRONT_MATTER.match(text)
    if not match:
        return {}, text
    metadata = yaml.safe_load(match.group(1))
    return (metadata if isinstance(metadata, dict) else {}), text[match.end():]


def check(check_id: str, title: str, items: list[dict], ok: str, problem: Callable[[int], str],
          level: str = "warning") -> dict:
    """A row of the tab: its items say where; `ok`, or `problem(count)`, sums it up."""
    return {
        "id": check_id,
        "title": title,
        "level": level if items else "ok",
        "summary": problem(len(items)) if items else ok,
        "items": items,
    }


def projects_count(count: int) -> str:
    return plural(count, "проекте", "проектах", "проектах")


def content_checks(root: Path) -> dict:
    config = yaml.safe_load((root / "_config.yml").read_text(encoding="utf-8")) or {}
    projects = []
    for project_file in sorted((root / "projects").glob("*/index.md")):
        metadata, body = read_project(project_file)
        projects.append({
            "slug": project_file.parent.name,
            "title": str(metadata.get("title") or project_file.parent.name),
            "metadata": metadata,
            "body": body,
            "directory": project_file.parent,
        })

    unlisted, untitled, short_texts, addresses, heavy = [], [], [], [], []
    for project in projects:
        name, slug, metadata = project["title"], project["slug"], project["metadata"]
        files = [path.name for path in unreferenced_images(project["directory"])]
        if files:
            unlisted.append({"slug": slug, "anchor": "unlisted", "count": len(files),
                             "text": f"«{name}»: {', '.join(files)}"})

        images = [image for image in metadata.get("images") or [] if isinstance(image, dict)]
        no_caption = [image for image in images if not str(image.get("caption") or "").strip()]
        no_description = [image for image in images if not str(image.get("description") or "").strip()]
        if no_caption or no_description:
            parts = []
            if no_caption:
                parts.append(f"без названия — {len(no_caption)}")
            if no_description:
                parts.append(f"без описания — {len(no_description)}")
            untitled.append({"slug": slug, "text": f"«{name}»: {', '.join(parts)}"})

        description = str(metadata.get("description") or "").strip()
        problems = []
        if not description:
            problems.append("нет описания для поиска")
        elif len(description) > SNIPPET_LIMIT:
            problems.append(f"описание для поиска длиннее {SNIPPET_LIMIT} символов ({len(description)}) — Google его обрежет")
        if not project["body"].strip():
            problems.append("нет текста на странице проекта")
        if problems:
            short_texts.append({"slug": slug, "text": f"«{name}»: {'; '.join(problems)}"})

        seen: dict[str, int] = {}
        for image in images:
            stem = Path(str(image.get("file", ""))).stem
            address = artwork_address(str(image.get("caption") or stem))
            seen[address] = seen.get(address, 0) + 1
        repeated = [address for address, times in seen.items() if times > 1]
        if repeated:
            addresses.append({"slug": slug, "text": f"«{name}»: одинаковые названия у нескольких работ ({', '.join('#' + a for a in repeated)}) — их ссылки получат -2, -3"})

        for image in images:
            path = project["directory"] / str(image.get("file", ""))
            if not path.is_file():
                continue
            limit = HEAVY_ANIMATION_BYTES if path.suffix.lower() == ".gif" else HEAVY_IMAGE_BYTES
            size = path.stat().st_size
            if size > limit:
                heavy.append({"slug": slug, "text": f"«{name}»: {path.name} — {megabytes(size)}, долго открывается в просмотре"})

    artist = config.get("artist") or {}
    settings = []
    site_description = str(config.get("description") or "").strip()
    if not site_description:
        settings.append({"view": "advanced", "text": "Нет описания сайта для поиска («Дополнительно»)"})
    elif len(site_description) > SNIPPET_LIMIT:
        settings.append({"view": "advanced", "text": f"Описание сайта длиннее {SNIPPET_LIMIT} символов ({len(site_description)})"})
    if not (config.get("search_console") or {}).get("verification"):
        settings.append({"view": "advanced", "text": "Нет кода Google Search Console («Дополнительно»)"})
    if not str(artist.get("full_name") or "").strip():
        settings.append({"view": "settings", "text": "Не указано полное имя («Об авторе») — его видят поисковики"})

    checks = [
        check("unlisted", "Файлы, которых нет на сайте", unlisted,
              "Все файлы в папках проектов используются.",
              lambda count: f"Лежат в папках, но не добавлены в проекты — в {projects_count(count)}. "
                            "Их можно добавить или удалить в блоке «Не на сайте» на странице проекта.",
              level="info"),
        check("texts", "Тексты проектов", short_texts,
              "У всех проектов есть описание для поиска и текст на странице.",
              lambda count: f"Не хватает текстов в {projects_count(count)} — по ним ищут и их показывают в превью ссылок."),
        check("captions", "Названия и описания работ", untitled,
              "У всех работ есть название и описание.",
              lambda count: f"Не у всех работ есть название или описание — в {projects_count(count)}.", level="info"),
        check("addresses", "Ссылки на работы", addresses,
              "У всех работ разные адреса.",
              lambda count: f"Повторяются названия работ — в {projects_count(count)}."),
        check("heavy", "Тяжёлые файлы", heavy,
              "Все оригиналы открываются быстро.",
              lambda count: f"Очень большие оригиналы: {plural(count, 'файл', 'файла', 'файлов')}. "
                            "Лучше загрузить их заново через «Заменить файл…» — конструктор сам их уменьшит."),
        check("settings", "Настройки сайта", settings,
              "Описание сайта, полное имя и код Search Console на месте.",
              lambda count: f"Стоит заполнить: {plural(count, 'пункт', 'пункта', 'пунктов')}."),
    ]
    return {
        "checks": checks,
        "warnings": sum(1 for item in checks if item["level"] == "warning"),
        "unlisted_files": sum(item.get("count", 0) for item in unlisted),
    }


# ---------------------------------------------------------------------------
# The published site
# ---------------------------------------------------------------------------
def fetch_url(url: str, timeout: float) -> tuple[int, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except HTTPError as error:
        return error.code, error.read().decode("utf-8", errors="replace")


def address_checks(site_url: str, verification: str, fetch: Fetch) -> list[dict]:
    def get(path: str) -> tuple[int, str]:
        try:
            return fetch(site_url + path, FETCH_TIMEOUT)
        except (URLError, OSError, ValueError) as error:
            return 0, str(getattr(error, "reason", error))

    results = []

    status, body = get("")
    detail = "открывается" if status == 200 else f"ошибка {status or 'сети'}"
    ok = status == 200
    if ok and verification:
        if f'name="google-site-verification" content="{verification}"' in body:
            detail += ", код Search Console на месте"
        else:
            ok, detail = False, "открывается, но кода Search Console на ней нет — опубликуйте изменения"
    results.append({"title": "Главная", "path": "", "ok": ok, "detail": detail})

    status, body = get("sitemap.xml")
    pages, images = body.count("<loc>"), body.count("<image:loc>")
    results.append({"title": "Карта сайта для поисковиков", "path": "sitemap.xml", "ok": status == 200 and pages > 0,
                    "detail": f"{plural(pages, 'страница', 'страницы', 'страниц')}, {plural(images, 'работа', 'работы', 'работ')}" if status == 200 else f"ошибка {status or 'сети'}"})

    status, body = get("robots.txt")
    ok = status == 200 and "Sitemap:" in body and "ai-train=no" in body
    results.append({"title": "robots.txt: поиск разрешён, обучение ИИ запрещено", "path": "robots.txt", "ok": ok,
                    "detail": "на месте" if ok else f"ошибка {status or 'сети'}" if status != 200 else "нет нужных строк"})

    status, body = get(".well-known/tdmrep.json")
    ok = status == 200 and '"tdm-reservation": 1' in body
    results.append({"title": "Запрет на анализ данных (TDMRep)", "path": ".well-known/tdmrep.json", "ok": ok,
                    "detail": "на месте" if ok else f"ошибка {status or 'сети'}"})

    status, body = get(f"no-such-page-{uuid.uuid4().hex[:8]}/")
    ok = status == 404 and "could not be found" in body
    results.append({"title": "Страница «не найдено»", "path": "404.html", "ok": ok,
                    "detail": "своя страница 404" if ok else f"ответ {status or 'сети'}"})
    return results


def read_pagespeed_key(root: Path) -> str:
    try:
        key = (root / PAGESPEED_KEY_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return key if PAGESPEED_KEY.fullmatch(key) else ""


def save_pagespeed_key(root: Path, key: str) -> bool:
    """Store (or, when empty, forget) the key; True when one is stored."""
    key = key.strip()
    path = root / PAGESPEED_KEY_FILE
    if not key:
        path.unlink(missing_ok=True)
        return False
    if not PAGESPEED_KEY.fullmatch(key):
        raise ValueError("Это не похоже на ключ Google API: он из латинских букв и цифр, около 39 символов.")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(key + "\n", encoding="utf-8")
    path.chmod(0o600)
    return True


def pagespeed(site_url: str, strategy: str, fetch: Fetch, key: str = "") -> dict:
    parameters = [("url", site_url), ("strategy", strategy)] + [("category", name) for name in PAGESPEED_CATEGORIES]
    query = urlencode(parameters + ([("key", key)] if key else []))
    try:
        status, body = fetch(f"{PAGESPEED_API}?{query}", PAGESPEED_TIMEOUT)
    except (URLError, OSError, ValueError) as error:
        return {"error": f"Google PageSpeed не ответил: {getattr(error, 'reason', error)}"}
    if status == 429:
        if key:
            return {"error": "Лимит проверок по вашему ключу на сегодня исчерпан. Попробуйте завтра."}
        return {"error": "Общий бесплатный лимит Google на сегодня исчерпан. Откройте подробный отчёт на сайте Google "
                         "или добавьте свой бесплатный ключ ниже — с ним проверок хватит с запасом.", "quota": True}
    try:
        result = json.loads(body)
    except ValueError:
        return {"error": f"Google PageSpeed ответил ошибкой {status}."}
    if status != 200 or "lighthouseResult" not in result:
        message = (result.get("error") or {}).get("message") or f"ошибка {status}"
        return {"error": f"Google PageSpeed: {message}"}
    lighthouse = result["lighthouseResult"]
    categories = lighthouse.get("categories") or {}
    audits = lighthouse.get("audits") or {}
    score = lambda key: None if (categories.get(key) or {}).get("score") is None else round(categories[key]["score"] * 100)  # noqa: E731
    return {
        "performance": score("performance"),
        "accessibility": score("accessibility"),
        "best_practices": score("best-practices"),
        "seo": score("seo"),
        "lcp": (audits.get("largest-contentful-paint") or {}).get("displayValue", ""),
        "cls": (audits.get("cumulative-layout-shift") or {}).get("displayValue", ""),
    }


def live_checks(root: Path, fetch: Fetch = fetch_url) -> dict:
    key = read_pagespeed_key(root)
    config = yaml.safe_load((root / "_config.yml").read_text(encoding="utf-8")) or {}
    site_url = f"{config.get('url', '')}{config.get('baseurl', '') or ''}".rstrip("/") + "/"
    verification = str((config.get("search_console") or {}).get("verification") or "")
    with ThreadPoolExecutor(max_workers=3) as pool:
        mobile = pool.submit(pagespeed, site_url, "mobile", fetch, key)
        desktop = pool.submit(pagespeed, site_url, "desktop", fetch, key)
        addresses = address_checks(site_url, verification, fetch)
        result = {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "site_url": site_url,
            "report_url": f"https://pagespeed.web.dev/analysis?url={quote(site_url, safe='')}",
            "addresses": addresses,
            "speed": {"mobile": mobile.result(), "desktop": desktop.result()},
        }
    path = root / LIVE_RESULT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def last_live_checks(root: Path) -> dict | None:
    try:
        return json.loads((root / LIVE_RESULT_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
