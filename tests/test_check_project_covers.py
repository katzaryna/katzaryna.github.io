from pathlib import Path

import pytest

from scripts import check_project_covers


@pytest.mark.parametrize(
    "metadata",
    [
        {"images": [{"file": "01.png", "cover": True}]},
    ],
)
def test_has_selected_cover(metadata):
    assert check_project_covers.has_selected_cover(metadata)


@pytest.mark.parametrize(
    "metadata",
    [
        None,
        {},
        {"cover": {"file": "cover.png"}},
        {"cover": {"file": ""}},
        {"images": [{"file": "01.png"}]},
        {"images": [{"file": "01.png", "cover": "true"}]},
        {"images": [{"cover": True}]},
    ],
)
def test_has_no_selected_cover(metadata):
    assert not check_project_covers.has_selected_cover(metadata)


def test_removed_gallery_order_is_rejected():
    errors = check_project_covers.obsolete_order_errors(
        {"images": [{"file": "cover.png", "gallery_order": 1}]},
        Path("projects/example/index.md"),
    )

    assert len(errors) == 1
    assert "still uses removed `gallery_order`" in errors[0]


def test_project_without_gallery_order_passes_obsolete_order_check():
    assert check_project_covers.obsolete_order_errors(
        {"images": [{"file": "cover.png", "cover": True}]},
        Path("projects/example/index.md"),
    ) == []


def test_main_warns_only_for_projects_without_covers(tmp_path: Path, monkeypatch, capsys):
    projects_directory = tmp_path / "projects"
    without_cover = projects_directory / "without-cover"
    with_cover = projects_directory / "with-cover"
    without_cover.mkdir(parents=True)
    with_cover.mkdir()
    (without_cover / "index.md").write_text(
        "---\nlayout: project\ntitle: No cover\n---\n",
        encoding="utf-8",
    )
    (with_cover / "index.md").write_text(
        "---\nlayout: project\ntitle: Has cover\nimages:\n  - file: cover.png\n    cover: true\n---\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(check_project_covers, "ROOT", tmp_path)
    monkeypatch.setattr(check_project_covers, "PROJECTS", projects_directory)

    assert check_project_covers.main() == 0
    captured = capsys.readouterr()
    assert "WARNING: projects/without-cover/index.md" in captured.err
    assert "Mark an entry in `images` with `cover: true`." in captured.err
    assert "projects/with-cover/index.md" not in captured.err


def test_main_raises_for_missing_front_matter(tmp_path: Path, monkeypatch):
    projects_directory = tmp_path / "projects"
    project_directory = projects_directory / "invalid"
    project_directory.mkdir(parents=True)
    (project_directory / "index.md").write_text("No YAML here\n", encoding="utf-8")
    monkeypatch.setattr(check_project_covers, "ROOT", tmp_path)
    monkeypatch.setattr(check_project_covers, "PROJECTS", projects_directory)

    with pytest.raises(ValueError, match="missing YAML front matter"):
        check_project_covers.main()
