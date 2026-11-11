from __future__ import annotations

from scripts.change_summary import flatten, summarize


PLACES = [
    {"id": "header_tabs", "group": "Шапка", "label": "Вкладки About и Clients", "font": "Tenor Sans", "font_size": 19},
    {"id": "about_text", "group": "Окно About", "label": "Текст биографии", "font": "Inter", "font_size": 17, "align": "left"},
]
COLORS = [
    {"id": "background", "label": "Фон сайта", "color": "#ffffff"},
    {"id": "hover_overlay", "label": "Плашка при наведении на обложку", "color": "#000000", "opacity": 50},
]


def config(**extra) -> dict:
    base = {
        "title": "Katzaryna",
        "artist": {"name": "Katzaryna", "description": "Commercial Illustrator", "bio": "Short bio."},
        "home_gallery": {"single_page": True, "gap": "5px", "covers": []},
    }
    base.update(extra)
    return base


def test_unchanged_site_has_nothing_to_report() -> None:
    assert summarize(config(), config(), {}, PLACES, COLORS) == []


def test_about_fields_show_old_and_new_values_or_say_text_changed() -> None:
    after = config()
    after["artist"] = {"name": "Katzaryna", "description": "Illustrator", "bio": "A much longer biography " * 5,
                       "email": "kat@example.com"}

    assert summarize(config(), after, {}, PLACES, COLORS) == [{"title": "Об авторе", "details": [
        "Профессия: «Commercial Illustrator» → «Illustrator»",
        "Биография: изменён текст",
        "Email: добавлено «kat@example.com»",
    ]}]


def test_appearance_names_header_colours_and_text_styles() -> None:
    after = config(
        colors={"hover_overlay": {"color": "#3f2a14", "opacity": 60}},
        text_styles={"header_tabs": {"font": "Lora", "font_size": 24}, "about_text": {"align": "center"}},
    )
    after["artist"]["wordmark_image"] = "/assets/images/wordmark.webp"

    assert summarize(config(), after, {}, PLACES, COLORS) == [{"title": "Оформление", "details": [
        "Надпись в шапке: загружена новая картинка",
        "Плашка при наведении на обложку: #000000, 50% → #3f2a14, 60%",
        "Шапка — Вкладки About и Clients: шрифт Tenor Sans → Lora, размер 19 → 24 px",
        "Окно About — Текст биографии: выравнивание слева → по центру",
    ]}]


def test_clients_report_additions_removals_captions_and_order() -> None:
    before = config(clients=[{"logo": "a", "name": "Kneipp"}, {"logo": "b", "name": "Westin"}, {"logo": "c"}])
    after = config(clients=[{"logo": "b", "name": "Westin Hotels"}, {"logo": "a", "name": "Kneipp"}, {"logo": "d", "name": "Radio"}])

    assert summarize(before, after, {}, PLACES, COLORS) == [{"title": "Клиенты", "details": [
        "Добавлен логотип: «Radio»",
        "Удалён логотип: «без подписи»",
        "Подпись: «Westin» → «Westin Hotels»",
        "Изменён порядок логотипов",
    ]}]


def test_home_reports_settings_covers_and_order() -> None:
    cover = lambda project, file, x=0, y=0: {"project": project, "file": file, "x": x, "y": y, "width": 4, "height": 4}  # noqa: E731
    before = config()
    before["home_gallery"]["covers"] = [cover("books", "01.jpg"), cover("yoga", "02.jpg", x=4), cover("spa", "03.jpg", x=8)]
    after = config()
    after["home_gallery"] = {"single_page": False, "gap": "5px", "covers": [
        cover("yoga", "02.jpg", x=4, y=4), cover("books", "01.jpg"), cover("new", "04.jpg", y=8),
    ]}

    groups = summarize(before, after, {}, PLACES, COLORS, project_titles={"books": "Book Covers", "new": "New Work", "spa": "Spa"})

    assert groups == [{"title": "Главная", "details": [
        "Клик по обложке: открывает страницу проекта",
        "Добавлена обложка: New Work (04.jpg)",
        "Убрана обложка: Spa (03.jpg)",
        "Передвинуто или изменено: 1 обложка",
        "Изменён порядок обложек на телефоне",
    ]}]


def test_projects_report_new_deleted_and_detailed_edits() -> None:
    old = {"title": "Books", "images": [
        {"file": "01.jpg", "alt": "Cover"}, {"file": "02.jpg", "alt": "Back", "caption": "Back cover"},
    ]}
    new = {"title": "Book Covers", "images": [
        {"file": "02.jpg", "alt": "Back", "caption": "Back cover", "description": "Watercolour, 2024.", "cover": True},
        {"file": "01.jpg", "alt": "Cover", "caption": "Front"},
        {"file": "03.jpg", "alt": "Spine"},
    ]}
    projects = {
        "books": {"before": (old, "Text"), "after": (new, "Text"), "added_files": 1, "removed_files": 0},
        "summer": {"before": None, "after": ({"title": "Summer", "images": [{"file": "a.jpg"}]}, ""), "added_files": 1},
        "gone": {"before": ({"title": "Gone"}, ""), "after": None},
    }

    groups = summarize(config(), config(), projects, PLACES, COLORS)

    assert groups == [
        {"title": "Проект «Book Covers»", "details": [
            "Переименован: «Books» → «Book Covers»",
            "Добавлено: 1 изображение",
            "Описание иллюстрации у 02.jpg: добавлено «Watercolour, 2024.»",
            "02.jpg: отмечена как обложка на главной",
            "Название иллюстрации у 01.jpg: добавлено «Front»",
            "Изменён порядок изображений",
        ]},
        {"title": "Удалён проект «Gone»", "details": []},
        {"title": "Новый проект «Summer»", "details": ["1 изображение"]},
    ]
    assert flatten(groups)[1:] == ["Удалён проект «Gone»", "Новый проект «Summer»: 1 изображение"]


def test_replaced_image_keeps_its_story_in_project_and_home() -> None:
    old = {"title": "Books", "images": [
        {"file": "01.jpg", "alt": "Cover", "caption": "Front", "cover": True}, {"file": "02.jpg", "alt": "Back"},
    ]}
    new = {"title": "Books", "images": [
        {"file": "01-new.webp", "alt": "Cover", "caption": "Front", "cover": True}, {"file": "02.jpg", "alt": "Back"},
    ]}
    cover = lambda file: {"project": "books", "file": file, "x": 0, "y": 0, "width": 4, "height": 4}  # noqa: E731
    before, after = config(), config()
    before["home_gallery"]["covers"] = [cover("01.jpg")]
    after["home_gallery"]["covers"] = [cover("01-new.webp")]
    projects = {"books": {"before": (old, ""), "after": (new, ""), "added_files": 1, "removed_files": 0}}

    groups = summarize(before, after, projects, PLACES, COLORS, project_titles={"books": "Books"})

    assert groups == [
        {"title": "Главная", "details": ["Заменена картинка обложки: Books (01.jpg → 01-new.webp)"]},
        {"title": "Проект «Books»", "details": ["Заменён файл изображения: 01.jpg → 01-new.webp"]},
    ]


def test_a_new_upload_in_a_removed_images_place_is_not_a_replacement() -> None:
    old = {"title": "Books", "images": [{"file": "01.jpg", "alt": "Cover"}]}
    new = {"title": "Books", "images": [{"file": "02.webp", "alt": ""}]}
    projects = {"books": {"before": (old, ""), "after": (new, ""), "added_files": 1, "removed_files": 0}}

    assert summarize(config(), config(), projects, PLACES, COLORS)[0]["details"] == [
        "Добавлено: 1 изображение", "Убрано: 1 изображение",
    ]


def test_clients_tab_switch_is_reported() -> None:
    clients = [{"logo": "a", "name": "Kneipp"}]
    shown, hidden = config(clients=clients), config(clients=clients, clients_tab=False)

    assert flatten(summarize(shown, hidden, {}, PLACES, COLORS)) == ["Клиенты: Вкладка Clients: скрыта"]
    assert flatten(summarize(hidden, shown, {}, PLACES, COLORS)) == ["Клиенты: Вкладка Clients: показывается"]
