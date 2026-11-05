from scripts.generate_image_variants import responsive_widths


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

    generator.create_variants()
    assert "0 built, 1 unchanged" in capsys.readouterr().out

    Image.new("RGB", (600, 400), "blue").save(project / "art.png")
    generator.create_variants()
    assert "1 built, 0 unchanged" in capsys.readouterr().out
