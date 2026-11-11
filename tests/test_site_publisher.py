from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import subprocess

import pytest

from scripts.site_builder import SiteRepository
from scripts.site_publisher import Publisher, PublishError, parse_token_check, plural


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def project(title: str) -> str:
    return f"---\nlayout: project\ntitle: {title}\nimages: []\n---\n"


def clone(remote: Path, destination: Path, name: str) -> Path:
    git(remote.parent, "clone", "--quiet", "--branch", "main", str(remote), str(destination))
    git(destination, "config", "user.name", name)
    git(destination, "config", "user.email", f"{name.lower()}@example.com")
    return destination


@pytest.fixture
def sites(tmp_path: Path) -> tuple[Publisher, Path]:
    """A published site, her working copy, and a second computer that also publishes."""
    remote = tmp_path / "github.git"
    git(tmp_path, "init", "--quiet", "--bare", "--initial-branch=main", str(remote))
    seed = tmp_path / "seed"
    seed.mkdir()
    git(seed, "init", "--quiet", "--initial-branch=main")
    git(seed, "config", "user.name", "Seed")
    git(seed, "config", "user.email", "seed@example.com")
    write(seed / "_config.yml", "title: Site\nhome_gallery:\n  covers: []\n")
    write(seed / "projects" / "books" / "index.md", project("Books"))
    write(seed / "projects" / "books" / "01.png", "png")
    write(seed / "Makefile", "all:\n")
    git(seed, "add", ".")
    git(seed, "commit", "--quiet", "-m", "Initial")
    git(seed, "remote", "add", "origin", str(remote))
    git(seed, "push", "--quiet", "origin", "main")
    her = clone(remote, tmp_path / "her", "Kate")
    other = clone(remote, tmp_path / "other", "Him")
    publisher = Publisher(her)
    publisher.gh_json = lambda *args: None  # no GitHub CLI in tests
    return publisher, other


def remote_log(other: Path) -> list[str]:
    git(other, "pull", "--quiet", "--ff-only")
    return git(other, "log", "--format=%s").splitlines()


def test_plural_forms() -> None:
    assert plural(1, "изображение", "изображения", "изображений") == "1 изображение"
    assert plural(3, "изображение", "изображения", "изображений") == "3 изображения"
    assert plural(11, "изображение", "изображения", "изображений") == "11 изображений"
    assert plural(22, "изображение", "изображения", "изображений") == "22 изображения"


def test_status_describes_changes_in_plain_words(sites) -> None:
    publisher, _ = sites
    root = publisher.root
    write(root / "projects" / "books" / "02.webp", "webp")
    write(root / "projects" / "summer" / "index.md", project("Summer"))
    write(root / "_config.yml", "title: New title\nhome_gallery:\n  covers: []\n")
    write(root / "Makefile", "changed:\n")

    status = publisher.status()

    assert status["changes"] == [
        {"title": "Проект «Books»", "details": [
            "Загружено: 1 изображение — на сайте пока не видно, не добавлено в проект",
        ]},
        {"title": "Новый проект «Summer»", "details": []},
        {"title": "Дополнительно", "details": ["Название во вкладке браузера: «Site» → «New title»"]},
    ]
    assert status["change_count"] == 3  # the Makefile is not site content


def test_publish_commits_only_content_and_pushes(sites) -> None:
    publisher, other = sites
    root = publisher.root
    write(root / "projects" / "books" / "index.md", project("Books 2"))
    write(root / "Makefile", "local tweak:\n")

    status = publisher.publish("Переименовала проект")

    assert status["change_count"] == 0 and status["ahead"] == 0
    assert remote_log(other)[0] == "Переименовала проект"
    assert (other / "projects" / "books" / "index.md").read_text() == project("Books 2")
    assert (other / "Makefile").read_text() == "all:\n"
    assert git(root, "status", "--porcelain").strip() == "M Makefile"


def test_publish_without_changes_is_explained(sites) -> None:
    publisher, _ = sites
    with pytest.raises(PublishError, match="Публиковать нечего"):
        publisher.publish()


def test_publish_combines_with_changes_from_another_computer(sites) -> None:
    publisher, other = sites
    write(other / "projects" / "books" / "02.png", "png")
    git(other, "add", ".")
    git(other, "commit", "--quiet", "-m", "From the other computer")
    git(other, "push", "--quiet")
    write(publisher.root / "_config.yml", "title: Mine\nhome_gallery:\n  covers: []\n")

    publisher.publish()

    assert remote_log(other)[:2] == [
        "Дополнительно: Название во вкладке браузера: «Site» → «Mine»",
        "From the other computer",
    ]


def test_conflicting_publish_is_kept_and_reported(sites) -> None:
    publisher, other = sites
    write(other / "_config.yml", "title: His\nhome_gallery:\n  covers: []\n")
    git(other, "commit", "--quiet", "-am", "His title")
    git(other, "push", "--quiet")
    write(publisher.root / "_config.yml", "title: Hers\nhome_gallery:\n  covers: []\n")

    with pytest.raises(PublishError, match="пересеклись"):
        publisher.publish()

    assert not publisher.status()["busy"]
    assert (publisher.root / "_config.yml").read_text().startswith("title: Hers")
    branches = git(other, "ls-remote", "--heads", "origin", "help/*")
    assert "refs/heads/help/" in branches
    assert publisher.last_error


def test_sync_fast_forwards_and_reports_code_updates(sites) -> None:
    publisher, other = sites
    write(other / "projects" / "books" / "index.md", project("Renamed elsewhere"))
    write(other / "Makefile", "new:\n")
    git(other, "commit", "--quiet", "-am", "Remote update")
    git(other, "push", "--quiet")

    assert publisher.sync() == {"result": "updated", "code_changed": True}
    assert "Renamed elsewhere" in (publisher.root / "projects" / "books" / "index.md").read_text()
    assert publisher.sync() == {"result": "up-to-date"}


def test_sync_waits_when_local_edits_touch_the_same_file(sites) -> None:
    publisher, other = sites
    write(other / "_config.yml", "title: His\nhome_gallery:\n  covers: []\n")
    git(other, "commit", "--quiet", "-am", "His title")
    git(other, "push", "--quiet")
    write(publisher.root / "_config.yml", "title: Hers\nhome_gallery:\n  covers: []\n")

    assert publisher.sync() == {"result": "later"}
    assert "Hers" in (publisher.root / "_config.yml").read_text()


def test_undo_publishes_a_revert(sites) -> None:
    publisher, other = sites
    write(publisher.root / "projects" / "books" / "02.png", "png")
    publisher.publish("Добавила картинку")
    entry = publisher.history()[0]
    assert entry["subject"] == "Добавила картинку" and entry["mine"] and entry["can_undo"]

    publisher.undo(entry["sha"])

    assert remote_log(other)[0] == "Отмена: Добавила картинку"
    assert not (other / "projects" / "books" / "02.png").exists()


def test_undo_refuses_with_unpublished_edits(sites) -> None:
    publisher, _ = sites
    sha = publisher.history()[0]["sha"]
    write(publisher.root / "_config.yml", "title: Draft\n")
    with pytest.raises(PublishError, match="Сначала"):
        publisher.undo(sha)


def test_discard_keeps_a_recoverable_copy(sites) -> None:
    publisher, _ = sites
    write(publisher.root / "_config.yml", "title: Draft\n")
    write(publisher.root / "projects" / "new" / "index.md", project("New"))

    status = publisher.discard()

    assert status["change_count"] == 0
    assert not (publisher.root / "projects" / "new").exists()
    assert "отменённые правки" in git(publisher.root, "stash", "list")


def test_trash_lists_and_restores_deleted_projects(sites) -> None:
    publisher, _ = sites
    repository = SiteRepository(publisher.root)
    repository.delete_project("books")

    trash = repository.list_trash()
    assert [(item["slug"], item["title"]) for item in trash] == [("books", "Books")]

    repository.restore_project(trash[0]["name"])
    assert (publisher.root / "projects" / "books" / "index.md").is_file()
    assert repository.list_trash() == []


def test_technical_commits_cannot_be_undone_from_the_builder(sites) -> None:
    publisher, other = sites
    write(other / "Makefile", "changed:\n")
    write(other / "projects" / "books" / "index.md", project("Mixed"))
    git(other, "commit", "--quiet", "-am", "Code and content")
    git(other, "push", "--quiet")
    publisher.sync()

    latest = publisher.history()[0]
    assert latest["technical"] and not latest["can_undo"]
    with pytest.raises(PublishError, match="нельзя отменить"):
        publisher.undo(latest["sha"])


def test_token_check_reads_expiration_and_failures() -> None:
    now = datetime(2026, 11, 5, tzinfo=timezone.utc)
    headers = "HTTP/2.0 200 OK\nGithub-Authentication-Token-Expiration: {} UTC\n\n{{}}"

    assert parse_token_check(0, headers.format("2027-11-05 10:00:00"), now) == {
        "state": "ok", "expires": "2027-11-05T10:00:00+00:00", "days_left": 365,
    }
    assert parse_token_check(0, headers.format("2026-11-12 00:00:00"), now)["state"] == "expiring"
    assert parse_token_check(0, headers.format("2026-11-01 00:00:00"), now)["state"] == "invalid"
    assert parse_token_check(0, "HTTP/2.0 200 OK\n\n{}", now) == {"state": "ok", "expires": None}
    assert parse_token_check(1, "HTTP 401: Bad credentials", now) == {"state": "invalid"}
    assert parse_token_check(4, "To get started with GitHub CLI, please run:  gh auth login", now) == {"state": "missing"}
    assert parse_token_check(1, "error connecting to api.github.com", now) == {"state": "unknown"}


def test_set_token_rejects_text_that_is_not_a_token(sites) -> None:
    publisher, _ = sites
    with pytest.raises(PublishError, match="не похоже"):
        publisher.set_token("my password")


def test_publish_stops_on_content_problems_and_explains_them(sites) -> None:
    publisher, other = sites
    root = publisher.root
    publisher.checker = SiteRepository(root).check_content
    write(root / "projects" / "books" / "index.md", (
        "---\nlayout: project\ntitle: Books\nimages:\n"
        "  - file: 01.png\n    alt: ''\n  - file: missing.webp\n    alt: Missing\n---\n"
    ))
    write(root / "projects" / "books" / "broken.webp", "not an image")

    with pytest.raises(PublishError) as error:
        publisher.publish()

    message = str(error.value)
    assert "у картинки 01.png нет описания (alt)" in message
    assert "нет файла картинки missing.webp" in message
    assert "projects/books/broken.webp повреждена" in message
    assert publisher.status()["last_error"] == message
    assert remote_log(other) == ["Initial"]
    assert publisher.status()["ahead"] == 0  # nothing was committed


def test_header_and_client_changes_are_named(sites) -> None:
    publisher, _ = sites
    write(publisher.root / "_config.yml", (
        "title: Site\nartist:\n  wordmark_image: /assets/images/wordmark-k.webp\n"
        "home_gallery:\n  covers: []\nclients:\n  - logo: /assets/images/client-a.webp\n"
    ))
    write(publisher.root / "assets" / "images" / "client-a.webp", "webp")

    assert publisher.status()["changes"] == [
        {"title": "Клиенты", "details": ["Добавлен логотип: «без подписи»"]},
        {"title": "Оформление", "details": ["Надпись в шапке: загружена новая картинка"]},
    ]
