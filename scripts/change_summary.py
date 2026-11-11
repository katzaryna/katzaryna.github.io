"""Describe unpublished site changes in plain Russian, grouped like the builder's tabs.

The publisher compares the last published version with the working copy and
calls `summarize` with both configs and both versions of every changed project.
Each group is {"title": ..., "details": [...]}; details say what changed and,
for short values, from what to what.
"""
from __future__ import annotations

from collections.abc import Iterable


SHORT_VALUE = 60

ABOUT_FIELDS = (
    (("artist", "name"), "Имя на сайте"),
    (("artist", "full_name"), "Полное имя"),
    (("artist", "description"), "Профессия"),
    (("artist", "bio"), "Биография"),
    (("artist", "email"), "Email"),
    (("artist", "instagram_url"), "Instagram"),
    (("artist", "linkedin_url"), "LinkedIn"),
)
ADVANCED_FIELDS = (
    (("title",), "Название во вкладке браузера"),
    (("description",), "Описание для поисковиков"),
    (("analytics", "measurement_id"), "Google Analytics ID"),
)
HOME_SETTINGS = (
    ("single_page", "Клик по обложке", {True: "открывает просмотр", False: "открывает страницу проекта"}),
    ("compact", "Обложки сразу помещаются в экран", {True: "да", False: "нет"}),
    ("gap", "Отступ между обложками", None),
)
IMAGE_FIELDS = (
    ("caption", "Название иллюстрации"),
    ("description", "Описание иллюстрации"),
    ("alt", "Alt-текст"),
)
ALIGN_NAMES = {"left": "слева", "center": "по центру", "right": "справа"}


def plural(count: int, one: str, few: str, many: str) -> str:
    remainder_100, remainder_10 = count % 100, count % 10
    if remainder_10 == 1 and remainder_100 != 11:
        return f"{count} {one}"
    if 2 <= remainder_10 <= 4 and not 12 <= remainder_100 <= 14:
        return f"{count} {few}"
    return f"{count} {many}"


def get(source: dict | None, path: Iterable[str]):
    value = source
    for key in path:
        value = value.get(key) if isinstance(value, dict) else None
    return value


def shown(value) -> str:
    if value in (None, ""):
        return "—"
    return f"«{value}»"


def change(label: str, before, after) -> str:
    """'Профессия: «A» → «B»' for short values, 'Биография: изменён текст' for long ones."""
    if before in (None, "") and after not in (None, ""):
        return f"{label}: добавлено «{after}»" if len(str(after)) <= SHORT_VALUE else f"{label}: добавлен текст"
    if after in (None, ""):
        return f"{label}: убрано"
    if len(str(before)) <= SHORT_VALUE and len(str(after)) <= SHORT_VALUE:
        return f"{label}: {shown(before)} → {shown(after)}"
    return f"{label}: изменён текст"


def names(items: list[str], limit: int = 3) -> str:
    listed = ", ".join(f"«{item}»" for item in items[:limit])
    return listed + (f" и ещё {len(items) - limit}" if len(items) > limit else "")


# ---------------------------------------------------------------------------
# Site settings
# ---------------------------------------------------------------------------
def field_changes(before: dict, after: dict, fields) -> list[str]:
    return [
        change(label, get(before, path), get(after, path))
        for path, label in fields
        if (get(before, path) or "") != (get(after, path) or "")
    ]


def header_changes(before: dict, after: dict) -> list[str]:
    details = []
    old, new = get(before, ("artist", "wordmark_image")), get(after, ("artist", "wordmark_image"))
    if old != new:
        details.append("Надпись в шапке: " + (
            "убрана, имя показывается текстом" if not new else "загружена новая картинка"
        ))
    if get(before, ("artist", "portrait")) != get(after, ("artist", "portrait")):
        details.append("Портрет: загружен новый")
    if (get(before, ("artist", "portrait_alt")) or "") != (get(after, ("artist", "portrait_alt")) or ""):
        details.append(change("Описание портрета", get(before, ("artist", "portrait_alt")),
                              get(after, ("artist", "portrait_alt"))))
    return details


def color_text(setting: dict, value: dict | None) -> str:
    value = value or {}
    text = value.get("color", setting["color"])
    if "opacity" in setting:
        text += f", {value.get('opacity', setting['opacity'])}%"
    return text


def color_changes(before: dict, after: dict, settings: list[dict]) -> list[str]:
    old, new = before.get("colors") or {}, after.get("colors") or {}
    return [
        f"{setting['label']}: {color_text(setting, old.get(setting['id']))} → {color_text(setting, new.get(setting['id']))}"
        for setting in settings
        if old.get(setting["id"]) != new.get(setting["id"])
    ]


def text_style_changes(before: dict, after: dict, places: list[dict]) -> list[str]:
    old, new = before.get("text_styles") or {}, after.get("text_styles") or {}
    details = []
    for place in places:
        was, now = old.get(place["id"]) or {}, new.get(place["id"]) or {}
        if was == now:
            continue
        parts = []
        font_was, font_now = was.get("font") or place.get("font") or "Arial", now.get("font") or place.get("font") or "Arial"
        if font_was != font_now:
            parts.append(f"шрифт {font_was} → {font_now}")
        size_was, size_now = was.get("font_size", place["font_size"]), now.get("font_size", place["font_size"])
        if size_was != size_now:
            parts.append(f"размер {size_was} → {size_now} px")
        if place.get("align"):
            align_was, align_now = was.get("align", place["align"]), now.get("align", place["align"])
            if align_was != align_now:
                parts.append(f"выравнивание {ALIGN_NAMES[align_was]} → {ALIGN_NAMES[align_now]}")
        if parts:
            details.append(f"{place['group']} — {place['label']}: {', '.join(parts)}")
    return details


def client_changes(before: dict, after: dict) -> list[str]:
    old, new = before.get("clients") or [], after.get("clients") or []
    old_by_logo = {client["logo"]: client for client in old}
    new_by_logo = {client["logo"]: client for client in new}
    label = lambda client: client.get("name") or "без подписи"  # noqa: E731
    details = []
    added = [label(client) for client in new if client["logo"] not in old_by_logo]
    removed = [label(client) for client in old if client["logo"] not in new_by_logo]
    if added:
        details.append(f"Добавлены логотипы: {names(added)}" if len(added) > 1 else f"Добавлен логотип: «{added[0]}»")
    if removed:
        details.append(f"Удалены логотипы: {names(removed)}" if len(removed) > 1 else f"Удалён логотип: «{removed[0]}»")
    for client in new:
        previous = old_by_logo.get(client["logo"])
        if previous and (previous.get("name") or "") != (client.get("name") or ""):
            details.append(change("Подпись", previous.get("name"), client.get("name")))
    kept_old = [client["logo"] for client in old if client["logo"] in new_by_logo]
    kept_new = [client["logo"] for client in new if client["logo"] in old_by_logo]
    if kept_old != kept_new:
        details.append("Изменён порядок логотипов")
    return details


def home_changes(before: dict, after: dict, titles: dict[str, str]) -> list[str]:
    old, new = before.get("home_gallery") or {}, after.get("home_gallery") or {}
    details = []
    for key, label, values in HOME_SETTINGS:
        if old.get(key) != new.get(key):
            if values:
                details.append(f"{label}: {values.get(bool(new.get(key)), new.get(key))}")
            else:
                details.append(f"{label}: {old.get(key)} → {new.get(key)}")
    cover_id = lambda cover: (cover["project"], cover["file"])  # noqa: E731
    shown_old = {cover_id(cover): cover for cover in old.get("covers") or [] if not cover.get("parked")}
    shown_new = {cover_id(cover): cover for cover in new.get("covers") or [] if not cover.get("parked")}
    describe = lambda key: f"{titles.get(key[0], key[0])} ({key[1]})"  # noqa: E731
    added = [describe(key) for key in shown_new if key not in shown_old]
    removed = [describe(key) for key in shown_old if key not in shown_new]
    if added:
        details.append(f"Добавлены обложки: {names(added)}" if len(added) > 1 else f"Добавлена обложка: {added[0]}")
    if removed:
        details.append(f"Убраны обложки: {names(removed)}" if len(removed) > 1 else f"Убрана обложка: {removed[0]}")
    layout = ("x", "y", "width", "height", "crop", "crop_x", "crop_y")
    moved = sum(
        1 for key, cover in shown_new.items()
        if key in shown_old and any(cover.get(field) != shown_old[key].get(field) for field in layout)
    )
    if moved:
        details.append(f"Передвинуто или изменено: {plural(moved, 'обложка', 'обложки', 'обложек')}")
    order_old = [key for key in shown_old if key in shown_new]
    order_new = [key for key in shown_new if key in shown_old]
    if order_old != order_new:
        details.append("Изменён порядок обложек на телефоне")
    return details


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
def project_changes(before: tuple[dict, str] | None, after: tuple[dict, str] | None,
                    added_files: int, removed_files: int, slug: str) -> dict | None:
    if after is None and before is None:
        return None
    if before is None:
        metadata, _ = after
        count = len(metadata.get("images") or [])
        details = [plural(count, "изображение", "изображения", "изображений")] if count else []
        return {"title": f"Новый проект «{metadata.get('title') or slug}»", "details": details}
    if after is None:
        return {"title": f"Удалён проект «{before[0].get('title') or slug}»", "details": []}
    (old, old_text), (new, new_text) = before, after
    details = []
    if old.get("title") != new.get("title"):
        details.append(f"Переименован: {shown(old.get('title'))} → {shown(new.get('title'))}")
    if (old_text or "").strip() != (new_text or "").strip():
        details.append(change("Текст о проекте", (old_text or "").strip(), (new_text or "").strip()))
    if old.get("permalink") != new.get("permalink"):
        details.append(change("Адрес страницы", old.get("permalink"), new.get("permalink")))
    old_images = {image["file"]: image for image in old.get("images") or []}
    new_images = {image["file"]: image for image in new.get("images") or []}
    added = [file for file in new_images if file not in old_images]
    removed = [file for file in old_images if file not in new_images]
    if added:
        details.append(f"Добавлено: {plural(len(added), 'изображение', 'изображения', 'изображений')}")
    if removed:
        details.append(f"Убрано: {plural(len(removed), 'изображение', 'изображения', 'изображений')}")
    for file, image in new_images.items():
        previous = old_images.get(file)
        if not previous:
            continue
        for field, label in IMAGE_FIELDS:
            if (previous.get(field) or "") != (image.get(field) or ""):
                details.append(change(f"{label} у {file}", previous.get(field), image.get(field)))
        if bool(previous.get("cover")) != bool(image.get("cover")):
            details.append(f"{file}: {'отмечена' if image.get('cover') else 'снята'} как обложка на главной")
        if (previous.get("span_columns"), previous.get("row")) != (image.get("span_columns"), image.get("row")):
            details.append(f"{file}: изменена ширина или ряд в сетке")
    kept_old = [file for file in old_images if file in new_images]
    kept_new = [file for file in new_images if file in old_images]
    if kept_old != kept_new:
        details.append("Изменён порядок изображений")
    layout_keys = ("gallery_columns", "gallery")
    if any(old.get(key) != new.get(key) for key in layout_keys):
        details.append("Изменена сетка галереи")
    unlisted = added_files - len(added)
    if unlisted > 0:
        details.append(
            f"Загружено: {plural(unlisted, 'изображение', 'изображения', 'изображений')} — "
            "на сайте пока не видно, не добавлено в проект"
        )
    if not details and removed_files:
        details.append(f"Удалено файлов изображений: {removed_files}")
    if not details:
        return None
    return {"title": f"Проект «{new.get('title') or slug}»", "details": details}


# ---------------------------------------------------------------------------
# Everything
# ---------------------------------------------------------------------------
def summarize(before_config: dict, after_config: dict, projects: dict[str, dict],
              places: list[dict], colors: list[dict], project_titles: dict[str, str] | None = None,
              other_files: int = 0) -> list[dict]:
    """Groups of changes.

    `projects` maps a changed project's slug to {before, after, added_files, removed_files},
    where before/after are (metadata, text) or None; `project_titles` names every project
    for home cover changes.
    """
    titles = dict(project_titles or {})
    for slug, info in projects.items():
        metadata = (info.get("after") or info.get("before") or ({}, ""))[0]
        titles.setdefault(slug, metadata.get("title") or slug)
    groups = []

    def add(title: str, details: list[str]) -> None:
        if details:
            groups.append({"title": title, "details": details})

    add("Главная", home_changes(before_config, after_config, titles))
    for slug, info in sorted(projects.items()):
        group = project_changes(info.get("before"), info.get("after"),
                                info.get("added_files", 0), info.get("removed_files", 0), slug)
        if group:
            groups.append(group)
    add("Клиенты", client_changes(before_config, after_config))
    add("Об авторе", field_changes(before_config, after_config, ABOUT_FIELDS))
    add("Оформление", header_changes(before_config, after_config)
        + color_changes(before_config, after_config, colors)
        + text_style_changes(before_config, after_config, places))
    add("Дополнительно", field_changes(before_config, after_config, ADVANCED_FIELDS))
    if other_files and not groups:
        add("Технические файлы", [plural(other_files, "файл", "файла", "файлов")])
    return groups


def flatten(groups: list[dict]) -> list[str]:
    """One line per group, for places that need plain text."""
    return [
        f"{group['title']}: {'; '.join(group['details'])}" if group["details"] else group["title"]
        for group in groups
    ]
