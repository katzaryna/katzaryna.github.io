from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
from types import SimpleNamespace
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image
import pytest
import yaml

from scripts.site_builder import (
    BuilderServer,
    ConflictError,
    PreviewServer,
    SiteRepository,
    normalize_cover_orders,
    parse_project,
    serialize_project,
    validate_image_name,
    validate_slug,
)


def create_site(root: Path) -> SiteRepository:
    (root / "projects").mkdir(parents=True)
    (root / "_config.yml").write_text(
        yaml.safe_dump({
            "exclude": ["site-builder"],
            "home_gallery": {"compact": True, "single_page": True, "gap": "5px"},
        }),
        encoding="utf-8",
    )
    return SiteRepository(root)


def image_bytes(image_format: str = "PNG") -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 3), color="blue").save(buffer, format=image_format)
    return buffer.getvalue()


def test_validate_project_slugs_and_image_names() -> None:
    assert validate_slug("summer-stories-2") == "summer-stories-2"
    assert validate_image_name("cover 01.webp") == "cover 01.webp"

    with pytest.raises(ValueError):
        validate_slug("../outside")
    with pytest.raises(ValueError):
        validate_image_name("../cover.png")
    with pytest.raises(ValueError):
        validate_image_name("cover.svg")


def test_parse_and_serialize_project_preserve_markdown_body() -> None:
    source = '---\nlayout: project\ntitle: "My project"\nimages: []\n---\nA **description**.\n'

    metadata, content = parse_project(source)
    restored, restored_content = parse_project(serialize_project(metadata, content))

    assert restored == metadata
    assert restored_content == content


def test_normalize_cover_orders_preserves_visual_order() -> None:
    images = [
        {"file": "first.jpg", "cover": True, "gallery_order": 40},
        {"file": "detail.jpg"},
        {"file": "second.jpg", "cover": True, "gallery_order": 9},
        {"file": "third.jpg", "cover": True, "gallery_order": 1},
    ]

    normalize_cover_orders(images)

    assert [image.get("gallery_order") for image in images] == [3, None, 2, 1]


def test_repository_creates_uploads_and_saves_project(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    project = repository.create_project("summer-stories", "Summer Stories")
    assert project["metadata"]["permalink"] == "/projects/summer-stories/"

    repository.save_image("summer-stories", "first.png", image_bytes())
    repository.save_image("summer-stories", "second.png", image_bytes())
    metadata = project["metadata"]
    metadata["images"] = [
        {"file": "first.png", "alt": "First", "cover": True, "gallery_order": 20},
        {"file": "second.png", "alt": "Second", "cover": True, "gallery_order": 5},
    ]
    repository.save_project("summer-stories", metadata, "Description")
    metadata["images"][0]["alt"] = ""
    with pytest.raises(ValueError, match="needs non-empty alt text"):
        repository.save_project("summer-stories", metadata, "Description")
    metadata["images"][0]["alt"] = "First"

    saved = repository.state()["projects"][0]
    assert saved["content"] == "Description"
    assert [image["gallery_order"] for image in saved["metadata"]["images"]] == [2, 1]
    assert saved["files"] == ["first.png", "second.png"]


def test_repository_rejects_bad_image_and_duplicate_project(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    repository.create_project("new-work", "New Work")

    with pytest.raises(ValueError, match="match the filename extension"):
        repository.save_image("new-work", "cover.jpg", image_bytes("PNG"))
    with pytest.raises(ConflictError, match="already exists"):
        repository.create_project("new-work", "Duplicate")


def test_repository_rejects_project_directory_symlink(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (tmp_path / "projects" / "escape").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="inside the projects folder"):
        repository.create_project("escape", "Escape")


def test_repository_keeps_builder_excluded_from_generated_site(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    config = repository.read_config()
    config["exclude"] = ["tests"]

    with pytest.raises(ValueError, match="Keep site-builder"):
        repository.save_config(config)


def test_config_save_preserves_folded_bio_and_wraps_yaml_lines(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    config = repository.read_config()
    config["artist"] = {
        "bio": (
            "An artist based in Warsaw. She creates editorial and fashion illustration "
            "for print and digital media, combining traditional and digital techniques."
        ),
    }

    repository.save_config(config)

    saved_yaml = repository.config_path.read_text(encoding="utf-8")
    assert "  bio: >-" in saved_yaml
    assert max(map(len, saved_yaml.splitlines())) < 240
    assert repository.read_config() == config


def test_build_runs_image_generation_before_jekyll(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repository = create_site(tmp_path)
    commands = []

    def fake_run(command: list[str], **_kwargs: object) -> SimpleNamespace:
        commands.append(command)
        return SimpleNamespace(returncode=0, stdout="done", stderr="")

    monkeypatch.setattr("scripts.site_builder.subprocess.run", fake_run)

    assert repository.build_site() == "done\ndone"
    assert commands[0][-1] == "scripts/generate_image_variants.py"
    assert commands[1] == ["jekyll", "build"]


def test_local_http_server_serves_site_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = create_site(tmp_path)
    monkeypatch.setattr(repository, "build_site", lambda: "Build complete")
    (tmp_path / "_site").mkdir()
    (tmp_path / "_site" / "index.html").write_text("<h1>Preview</h1>", encoding="utf-8")
    (tmp_path / "_site" / "assets").mkdir()
    (tmp_path / "_site" / "assets" / "styles.css").write_text("body {}", encoding="utf-8")
    preview_server = PreviewServer(("127.0.0.1", 0), repository)
    preview_thread = threading.Thread(target=preview_server.serve_forever, daemon=True)
    preview_thread.start()
    preview_url = f"http://127.0.0.1:{preview_server.server_port}/"
    server = BuilderServer(("127.0.0.1", 0), repository, preview_url)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base_url = f"http://127.0.0.1:{server.server_port}"
        with urlopen(f"{base_url}/") as response:
            assert "локальный конструктор" in response.read().decode("utf-8")
        with urlopen(f"{preview_url}") as response:
            assert response.read() == b"<h1>Preview</h1>"
        with urlopen(f"{preview_url}assets/styles.css") as response:
            assert response.read() == b"body {}"
        with pytest.raises(HTTPError) as error:
            urlopen(f"{preview_url}%2e%2e/_config.yml")
        assert error.value.code == 404
        with urlopen(f"{base_url}/api/state") as response:
            result = json.loads(response.read())
        assert result["projects"] == []
        assert result["config"]["home_gallery"]["compact"] is True
        build_request = Request(
            f"{base_url}/api/build",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(build_request) as response:
            build_result = json.loads(response.read())
        assert build_result["preview_url"] == preview_url
        assert build_result["output"] == "Build complete"

        request = Request(
            f"{base_url}/api/projects",
            data=json.dumps({"slug": "new-work", "title": "New Work"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request) as response:
            project = json.loads(response.read())
        assert project["slug"] == "new-work"

        image_request = Request(
            f"{base_url}/api/projects/new-work/images/cover.png",
            data=image_bytes(),
            headers={"Content-Type": "image/png"},
            method="PUT",
        )
        with urlopen(image_request) as response:
            assert response.status == 201

        metadata = project["metadata"]
        metadata["images"] = [{"file": "cover.png", "alt": "Cover", "cover": True, "gallery_order": 1}]
        save_request = Request(
            f"{base_url}/api/projects/new-work",
            data=json.dumps({"metadata": metadata, "content": "Project text"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        with urlopen(save_request) as response:
            assert json.loads(response.read())["ok"] is True

        with urlopen(f"{base_url}/api/state") as response:
            saved_state = json.loads(response.read())
        assert saved_state["projects"][0]["metadata"]["images"][0]["file"] == "cover.png"

        cross_origin_request = Request(
            f"{base_url}/api/config",
            data=json.dumps({"config": result["config"]}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Origin": "http://malicious.example",
            },
            method="POST",
        )
        with pytest.raises(HTTPError) as error:
            urlopen(cross_origin_request)
        assert error.value.code == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        preview_server.shutdown()
        preview_server.server_close()
        preview_thread.join(timeout=2)
