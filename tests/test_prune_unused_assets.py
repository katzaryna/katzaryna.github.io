from pathlib import Path

from scripts.project_files import unreferenced_images
from scripts.prune_unused_assets import prune


def make_project(projects: Path) -> Path:
    project = projects / "demo"
    project.mkdir(parents=True)
    (project / "index.md").write_text(
        "---\nlayout: project\ntitle: Demo\nimages:\n- file: used.webp\n  alt: Used\n---\n",
        encoding="utf-8",
    )
    for name in ("used.webp", "unused.png", "notes.txt"):
        (project / name).write_bytes(b"x")
    return project


def test_unreferenced_images_lists_only_unlisted_images(tmp_path: Path) -> None:
    project = make_project(tmp_path / "projects")
    assert [path.name for path in unreferenced_images(project)] == ["unused.png"]


def test_prune_removes_unreferenced_images_from_built_site(tmp_path: Path) -> None:
    projects = tmp_path / "projects"
    make_project(projects)
    built = tmp_path / "_site" / "projects" / "demo"
    built.mkdir(parents=True)
    for name in ("used.webp", "unused.png", "index.html"):
        (built / name).write_bytes(b"x")

    removed = prune(tmp_path / "_site", projects)

    assert [path.name for path in removed] == ["unused.png"]
    assert sorted(path.name for path in built.iterdir()) == ["index.html", "used.webp"]
