from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
from types import SimpleNamespace
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageCms
import pytest
import yaml

from scripts.site_builder import (
    BuilderServer,
    ConflictError,
    PreviewServer,
    SiteRepository,
    parse_project,
    round_cover_layout,
    serialize_project,
    validate_image_name,
    validate_home_gallery,
    validate_slug,
)


def create_site(root: Path) -> SiteRepository:
    (root / "projects").mkdir(parents=True)
    (root / "_config.yml").write_text(
        yaml.safe_dump({
            "exclude": ["site-builder"],
            "home_gallery": {
                "compact": True,
                "single_page": True,
                "gap": "5px",
                "covers": [],
            },
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


def test_upload_normalizes_filename(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    repository.create_project("artwork", "Artwork")

    assert repository.save_image("artwork", "Flower Large (Final).png", image_bytes()) == (
        "flower-large-final.webp"
    )
    assert repository.save_image("artwork", "Café_02.png", image_bytes()) == "cafe-02.webp"
    assert repository.save_image("artwork", "обложка.png", image_bytes()) == "image.webp"


def test_repository_creates_uploads_and_saves_project(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    project = repository.create_project("summer-stories", "Summer Stories")
    assert project["metadata"]["permalink"] == "/projects/summer-stories/"

    first_file = repository.save_image("summer-stories", "first.png", image_bytes())
    second_file = repository.save_image("summer-stories", "second.png", image_bytes())
    metadata = project["metadata"]
    metadata["images"] = [
        {"file": first_file, "alt": "First", "cover": True},
        {"file": second_file, "alt": "Second", "cover": True},
    ]
    covers = repository.save_project("summer-stories", metadata, "Description")
    assert [cover["file"] for cover in covers] == ["first.webp", "second.webp"]
    assert [(cover["x"], cover["y"], cover["width"], cover["height"]) for cover in covers] == [
        (0, 0, 6, 4),
        (0, 4, 6, 4),
    ]
    assert "gallery_order" not in metadata["images"][0]
    metadata["images"][0]["alt"] = ""
    with pytest.raises(ValueError, match="needs non-empty alt text"):
        repository.save_project("summer-stories", metadata, "Description")
    metadata["images"][0]["alt"] = "First"

    saved = repository.state()["projects"][0]
    assert saved["content"] == "Description"
    assert [image["file"] for image in saved["metadata"]["images"]] == ["first.webp", "second.webp"]
    assert saved["files"] == ["first.webp", "second.webp"]
    assert repository.state()["config"]["home_gallery"]["covers"] == covers


def test_upload_resizes_to_webp_and_preserves_wide_gamut_profile(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    repository.create_project("artwork", "Artwork")
    image = Image.new("RGB", (3000, 1500), color=(227, 71, 48))
    p3_source = Path(__file__).parent.parent / "projects" / "book-covers" / "01.jpg"
    with Image.open(p3_source) as source:
        image.info["icc_profile"] = source.info["icc_profile"]
    upload = BytesIO()
    image.save(upload, "JPEG", quality=95, icc_profile=image.info["icc_profile"])

    filename = repository.save_image("artwork", "large.jpg", upload.getvalue())

    assert filename == "large.webp"
    with Image.open(tmp_path / "projects" / "artwork" / filename) as result:
        assert result.size == (2560, 1280)
        profile = ImageCms.ImageCmsProfile(BytesIO(result.info["icc_profile"]))
        assert ImageCms.getProfileDescription(profile).strip() == "Display P3"
        with Image.open(BytesIO(upload.getvalue())) as original:
            original_pixel = original.getpixel((0, 0))
        converted_pixel = result.getpixel((0, 0))
        assert all(abs(source - output) < 10 for source, output in zip(original_pixel, converted_pixel))


def test_upload_preserves_transparency_and_animation(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    repository.create_project("artwork", "Artwork")

    transparent = BytesIO()
    Image.new("RGBA", (12, 8), (230, 40, 90, 72)).save(transparent, "PNG")
    transparent_name = repository.save_image("artwork", "transparent.png", transparent.getvalue())
    with Image.open(tmp_path / "projects" / "artwork" / transparent_name) as result:
        assert result.mode == "RGBA"
        assert result.getpixel((0, 0))[3] == 72

    frames = [Image.new("RGBA", (12, 8), color) for color in ("red", "blue")]
    animated = BytesIO()
    frames[0].save(
        animated,
        "GIF",
        save_all=True,
        append_images=frames[1:],
        duration=[100, 150],
        loop=0,
    )
    animated_name = repository.save_image("artwork", "animated.gif", animated.getvalue())
    with Image.open(tmp_path / "projects" / "artwork" / animated_name) as result:
        assert result.format == "WEBP"
        assert result.n_frames == 2
        assert result.info["loop"] == 0


def test_save_home_gallery_validates_and_persists_layout(tmp_path: Path) -> None:
    repository = create_site(tmp_path)
    project = repository.create_project("artwork", "Artwork")
    filename = repository.save_image("artwork", "cover.png", image_bytes())
    project["metadata"]["images"] = [{"file": filename, "alt": "Cover", "cover": True}]
    repository.save_project("artwork", project["metadata"], "")
    layout = [{
        "project": "artwork",
        "file": filename,
        "x": 0.25,
        "y": 2.5,
        "width": 10.75,
        "height": 1.25,
        "crop_x": 25,
        "crop_y": 80,
    }]

    assert repository.save_home_gallery(layout) == layout
    assert repository.read_config()["home_gallery"]["covers"] == layout
    with pytest.raises(ValueError, match="between 0 and 100"):
        repository.save_home_gallery([{**layout[0], "crop_x": 101}])
    with pytest.raises(ValueError, match="12-column canvas"):
        repository.save_home_gallery([{**layout[0], "width": 12}])
    with pytest.raises(ValueError, match="height must be between 0.5 and 12"):
        repository.save_home_gallery([{**layout[0], "height": 0.25}])


def test_round_cover_layout_keeps_touching_edges_without_overlap() -> None:
    left = round_cover_layout({"x": 0, "y": 9.206172326459717, "width": 3.30604444, "height": 4.95})
    right = round_cover_layout({"x": 3.30604444, "y": 9.206172326459717, "width": 5.4586, "height": 4.83})

    assert left["y"] == 9.2062
    assert left["width"] == 3.306
    assert right["x"] == 3.306
    validate_home_gallery({
        "exclude": ["site-builder"],
        "home_gallery": {"covers": [
            {"project": "a", "file": "1.png", **left},
            {"project": "a", "file": "2.png", **right},
        ]},
    })


def test_save_project_restores_project_file_when_config_write_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = create_site(tmp_path)
    project = repository.create_project("artwork", "Artwork")
    filename = repository.save_image("artwork", "cover.png", image_bytes())
    project_file = tmp_path / "projects" / "artwork" / "index.md"
    original_text = project_file.read_text(encoding="utf-8")

    from scripts import site_builder
    real_atomic_write = site_builder.atomic_write

    def failing_atomic_write(path: Path, text: str) -> None:
        if path.name == "_config.yml":
            raise OSError("disk full")
        real_atomic_write(path, text)

    monkeypatch.setattr(site_builder, "atomic_write", failing_atomic_write)
    project["metadata"]["images"] = [{"file": filename, "alt": "Cover", "cover": True}]

    with pytest.raises(OSError, match="disk full"):
        repository.save_project("artwork", project["metadata"], "")
    assert project_file.read_text(encoding="utf-8") == original_text


def test_validate_home_gallery_rejects_removed_legacy_keys() -> None:
    cover = {"project": "a", "file": "1.png", "x": 0, "y": 0, "width": 6, "height": 4}
    with pytest.raises(ValueError, match="removed keys"):
        validate_home_gallery({
            "exclude": ["site-builder"],
            "home_gallery": {"covers": [{**cover, "size": "large"}]},
        })
    with pytest.raises(ValueError, match="x must be between"):
        validate_home_gallery({
            "exclude": ["site-builder"],
            "home_gallery": {"covers": [{key: value for key, value in cover.items() if key != "x"}]},
        })


def test_validate_home_gallery_rejects_overlapping_covers() -> None:
    cover = {"project": "artwork", "file": "cover.webp", "x": 1, "y": 2, "width": 4, "height": 3}
    touching_config = {
        "exclude": ["site-builder"],
        "home_gallery": {"covers": [cover, {**cover, "project": "another-work", "x": 5}]},
    }
    config = {
        "exclude": ["site-builder"],
        "home_gallery": {"covers": [cover, {**cover, "project": "another-work", "x": 4}]},
    }

    validate_home_gallery(touching_config)
    with pytest.raises(ValueError, match="must not overlap"):
        validate_home_gallery(config)


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

    assert repository.build_site() == "done\ndone\ndone"
    assert commands[0][-2:] == ["-m", "scripts.generate_image_variants"]
    assert commands[1] == ["bundle", "exec", "jekyll", "build"]
    assert commands[2][-4:] == ["-m", "scripts.prune_unused_assets", "--site-dir", "_site"]


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
        with pytest.raises(HTTPError) as error:
            urlopen(Request(f"{base_url}/api/state", headers={"Host": "attacker.example"}))
        assert error.value.code == 400
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
            uploaded_image = json.loads(response.read())
            assert response.status == 201
        assert uploaded_image["file"] == "cover.webp"

        metadata = project["metadata"]
        metadata["images"] = [{"file": "cover.webp", "alt": "Cover", "cover": True}]
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
        assert saved_state["projects"][0]["metadata"]["images"][0]["file"] == "cover.webp"
        assert saved_state["config"]["home_gallery"]["covers"][0]["file"] == "cover.webp"

        home_gallery_request = Request(
            f"{base_url}/api/home-gallery",
            data=json.dumps({
                "covers": [{
                    "project": "new-work",
                    "file": "cover.webp",
                    "x": 1.5,
                    "y": 2.25,
                    "width": 9.5,
                    "height": 1.75,
                    "crop_x": 20,
                    "crop_y": 80,
                }],
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(home_gallery_request) as response:
            saved_cover = json.loads(response.read())["covers"][0]
            assert saved_cover["x"] == 1.5
            assert saved_cover["y"] == 2.25
            assert saved_cover["width"] == 9.5
            assert saved_cover["height"] == 1.75

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
