import base64
from io import BytesIO
from pathlib import Path

from PIL import Image

from scripts.generate_image_variants import PLACEHOLDER_SIZE, placeholder_data_uri, responsive_widths
from scripts.image_utils import color_manage_image


def decode_placeholder(uri: str) -> Image.Image:
    prefix = "data:image/webp;base64,"
    assert uri.startswith(prefix)
    image = Image.open(BytesIO(base64.b64decode(uri[len(prefix):])))
    image.load()
    return image


def test_placeholder_is_a_tiny_untagged_preview() -> None:
    profile = (Path(__file__).parent / "fixtures" / "display-p3.icc").read_bytes()
    source = Image.new("RGB", (600, 400), (0, 255, 0))
    source.info["icc_profile"] = profile
    uri = placeholder_data_uri(color_manage_image(source))

    preview = decode_placeholder(uri)
    assert max(preview.size) == PLACEHOLDER_SIZE
    assert preview.size == (16, 11)
    assert "icc_profile" not in preview.info
    # Display P3 green is outside sRGB: converted, it keeps some red.
    red, green, _ = preview.convert("RGB").getpixel((8, 5))
    assert green > 200 and red < 120
    assert len(uri) < 600


def test_transparent_images_get_no_placeholder() -> None:
    assert placeholder_data_uri(color_manage_image(Image.new("RGBA", (40, 40), (0, 0, 0, 0)))) is None


def test_responsive_widths_keep_full_source_resolution() -> None:
    targets = (480, 960, 1440)
    assert responsive_widths(300, targets) == [300]
    assert responsive_widths(480, targets) == [480]
    assert responsive_widths(854, targets) == [480, 854]
    assert responsive_widths(1280, targets) == [480, 960, 1280]
    assert responsive_widths(1440, targets) == [480, 960, 1440]
    assert responsive_widths(4000, targets) == [480, 960, 1440]


def test_generator_reuses_unchanged_outputs(tmp_path, monkeypatch, capsys) -> None:
    import shutil

    from PIL import Image

    from scripts import generate_image_variants as generator

    root = tmp_path
    (root / "config").mkdir()
    shutil.copy(generator.ROOT / "config" / "image_optimization.toml", root / "config")
    project = root / "projects" / "demo"
    project.mkdir(parents=True)
    (project / "index.md").write_text(
        "---\nlayout: project\ntitle: Demo\nimages:\n- file: art.png\n  alt: Art\n---\n", encoding="utf-8",
    )
    Image.new("RGB", (600, 400), "red").save(project / "art.png")
    monkeypatch.setattr(generator, "ROOT", root)
    monkeypatch.setattr(generator, "PROJECTS", root / "projects")
    monkeypatch.setattr(generator, "OUTPUT", root / "assets" / "optimized")
    monkeypatch.setattr(generator, "MANIFEST", root / "_data" / "variants.json")
    monkeypatch.setattr(generator, "CACHE", root / "assets" / "optimized" / ".build-cache.json")
    monkeypatch.setattr(generator, "settings_fingerprint", lambda: "settings")

    generator.create_variants()
    assert "1 built, 0 unchanged" in capsys.readouterr().out
    assert (root / "assets" / "optimized" / "demo" / "art" / "480.webp").is_file()
    import json

    entry = json.loads((root / "_data" / "variants.json").read_text())["projects/demo/art.png"]
    assert decode_placeholder(entry["placeholder"]).size == (16, 11)

    generator.create_variants()
    assert "0 built, 1 unchanged" in capsys.readouterr().out

    Image.new("RGB", (600, 400), "blue").save(project / "art.png")
    generator.create_variants()
    assert "1 built, 0 unchanged" in capsys.readouterr().out
