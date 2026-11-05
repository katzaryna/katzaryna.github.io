#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import functools
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import mimetypes
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
from urllib.parse import parse_qs, unquote, urlsplit

from PIL import Image, ImageCms, ImageOps
import tomli
import yaml

from scripts.image_utils import color_manage_image


ROOT = Path(__file__).resolve().parent.parent
BUILDER_DIR = ROOT / "site-builder"
PROJECT_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
IMAGE_EXTENSIONS = {
    ".gif": "GIF",
    ".jpeg": "JPEG",
    ".jpg": "JPEG",
    ".png": "PNG",
    ".webp": "WEBP",
}
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_IMAGE_PIXELS = 80_000_000
MAX_ANIMATED_FRAMES = 300
LEGACY_COVER_KEYS = ("size", "columns", "rows")
SITE_IMAGES_DIRECTORY = Path("assets") / "images"
TRASH_DIRECTORY = ".builder-trash"
THUMBNAIL_DIRECTORY = Path(".builder-cache") / "thumbnails"
THUMBNAIL_WIDTHS = (160, 480, 1200)
SERVER_SOURCES = (Path(__file__), Path(__file__).with_name("image_utils.py"))


def source_fingerprint() -> tuple[float, ...]:
    return tuple(path.stat().st_mtime if path.exists() else 0 for path in SERVER_SOURCES)


STARTED_FINGERPRINT = source_fingerprint()
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
LAYOUT_DECIMALS = 4
LAYOUT_EPSILON = 5e-4  # about 0.06 px on the site; absorbs rounding of touching edges
# Covers can be "parked" on the builder's pasteboard around the 12-column canvas.
# Parked covers are saved but not shown on the site, and may overlap.
PASTEBOARD_SIDE = 6
PASTEBOARD_TOP = 3
PASTEBOARD_BOTTOM_LIMIT = 160
IMAGE_SETTINGS = tomli.loads((ROOT / "config" / "image_optimization.toml").read_text())
UPLOAD_MAX_DIMENSION = int(IMAGE_SETTINGS["upload_max_dimension"])
UPLOAD_WEBP_QUALITY = int(IMAGE_SETTINGS["upload_webp_quality"])


class BuilderError(Exception):
    status = 400


class NotFoundError(BuilderError):
    status = 404


class ConflictError(BuilderError):
    status = 409


class BuildError(BuilderError):
    status = 500


class FoldedString(str):
    pass


class SiteConfigDumper(yaml.SafeDumper):
    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:
        return super().increase_indent(flow, False)


def preserve_config_styles(value: object) -> object:
    if isinstance(value, dict):
        return {
            key: FoldedString(item) if key == "bio" and isinstance(item, str)
            else preserve_config_styles(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [preserve_config_styles(item) for item in value]
    return value


SiteConfigDumper.add_representer(
    FoldedString,
    lambda dumper, value: dumper.represent_scalar(
        "tag:yaml.org,2002:str",
        str(value),
        style=">",
    ),
)


def validate_slug(slug: str) -> str:
    if not isinstance(slug, str) or not PROJECT_SLUG.fullmatch(slug):
        raise ValueError("Project slug must use lowercase letters, numbers, and hyphens.")
    return slug


def validate_image_name(filename: str) -> str:
    if (
        not isinstance(filename, str)
        or not filename
        or filename in {".", ".."}
        or Path(filename).name != filename
        or "/" in filename
        or "\\" in filename
        or any(ord(character) < 32 for character in filename)
        or Path(filename).suffix.lower() not in IMAGE_EXTENSIONS
    ):
        raise ValueError("Use a plain image filename ending in JPG, PNG, WebP, or GIF.")
    return filename


CYRILLIC_TO_LATIN = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya", "і": "i", "ў": "u",
})


def normalize_upload_stem(filename: str) -> str:
    ascii_stem = (
        unicodedata.normalize("NFKD", Path(filename).stem.lower().translate(CYRILLIC_TO_LATIN))
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    return re.sub(r"[^a-z0-9]+", "-", ascii_stem).strip("-") or "image"


def parse_project(text: str) -> tuple[dict, str]:
    match = re.match(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)(.*)\Z", text, re.DOTALL)
    if not match:
        raise ValueError("Project file must start with YAML front matter.")
    metadata = yaml.safe_load(match.group(1)) or {}
    if not isinstance(metadata, dict):
        raise ValueError("Project front matter must contain a YAML object.")
    images = metadata.get("images", [])
    if not isinstance(images, list) or any(not isinstance(image, dict) for image in images):
        raise ValueError("Project images must be a list of image objects.")
    return metadata, match.group(2)


def serialize_project(metadata: dict, content: str) -> str:
    front_matter = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=1000,
    )
    return f"---\n{front_matter}---\n{content}"


def validate_home_gallery(config: dict) -> None:
    home_gallery = config.get("home_gallery")
    if not isinstance(home_gallery, dict):
        raise ValueError("home_gallery must be a settings object.")
    for setting in ("compact", "single_page"):
        if setting in home_gallery and not isinstance(home_gallery[setting], bool):
            raise ValueError(f"home_gallery.{setting} must be enabled or disabled.")
    gap = home_gallery.get("gap", "5px")
    if not isinstance(gap, str) or not gap.strip() or len(gap) > 40 or any(
        character in gap for character in "<>{};"
    ):
        raise ValueError("Home gallery gap must be a simple CSS length.")
    covers = home_gallery.get("covers")
    if not isinstance(covers, list):
        raise ValueError("home_gallery.covers must be a list.")
    seen_covers = set()
    layouts = []
    for cover in covers:
        if not isinstance(cover, dict):
            raise ValueError("Each home gallery cover must be an object.")
        project = validate_slug(cover.get("project", ""))
        filename = validate_image_name(cover.get("file", ""))
        legacy_keys = [key for key in LEGACY_COVER_KEYS if key in cover]
        if legacy_keys:
            raise ValueError(
                f"Home gallery cover {project}/{filename} uses removed keys {legacy_keys}; "
                "use x, y, width, and height."
            )
        layout = home_cover_layout(cover)
        parked = cover.get("parked", False)
        if not isinstance(parked, bool):
            raise ValueError("Home gallery cover parked must be enabled or disabled.")
        if parked:
            validate_parked_layout(layout)
        for coordinate in ("x", "y", "width", "height") if not parked else ():
            value = layout[coordinate]
            minimum = 0 if coordinate in {"x", "y"} else 0.5
            maximum = 12 if coordinate in {"x", "width", "height"} else 120
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not minimum <= value <= maximum
            ):
                raise ValueError(
                    f"Home gallery cover {coordinate} must be between {minimum} and {maximum}."
                )
        if not parked and layout["x"] + layout["width"] > 12:
            raise ValueError("Home gallery cover must stay within the 12-column canvas.")
        if not parked and layout["y"] + layout["height"] > 120:
            raise ValueError("Home gallery cover must stay within the 120-row canvas.")
        overlapping = None if parked else next((
            other for other in layouts
            if layout["x"] < other["x"] + other["width"] - LAYOUT_EPSILON
            and layout["x"] + layout["width"] > other["x"] + LAYOUT_EPSILON
            and layout["y"] < other["y"] + other["height"] - LAYOUT_EPSILON
            and layout["y"] + layout["height"] > other["y"] + LAYOUT_EPSILON
        ), None)
        if overlapping:
            raise ValueError(
                f"Home gallery covers must not overlap: {project}/{filename} and {overlapping['id']}."
            )
        if not parked:
            layouts.append({**layout, "id": f"{project}/{filename}"})
        if "crop" in cover and not isinstance(cover["crop"], bool):
            raise ValueError("Home gallery cover crop must be enabled or disabled.")
        for axis in ("crop_x", "crop_y"):
            coordinate = cover.get(axis, 50)
            if (
                isinstance(coordinate, bool)
                or not isinstance(coordinate, (int, float))
                or not 0 <= coordinate <= 100
            ):
                raise ValueError(f"Home gallery cover {axis} must be between 0 and 100.")
        identifier = (project, filename)
        if identifier in seen_covers:
            raise ValueError(f"Duplicate home gallery cover: {project}/{filename}.")
        seen_covers.add(identifier)
    excluded = config.get("exclude")
    if (
        not isinstance(excluded, list)
        or any(not isinstance(item, str) for item in excluded)
        or "site-builder" not in excluded
    ):
        raise ValueError("Keep site-builder in the Jekyll exclude list so the local editor is not published.")


def validate_parked_layout(layout: dict) -> None:
    for coordinate, value in layout.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"Home gallery cover {coordinate} must be a number.")
    if not 0.5 <= layout["width"] <= 12 or not 0.5 <= layout["height"] <= 12:
        raise ValueError("Home gallery cover width and height must be between 0.5 and 12.")
    if layout["x"] < -PASTEBOARD_SIDE or layout["x"] + layout["width"] > 12 + PASTEBOARD_SIDE:
        raise ValueError("A parked cover must stay on the pasteboard beside the canvas.")
    if layout["y"] < -PASTEBOARD_TOP or layout["y"] + layout["height"] > PASTEBOARD_BOTTOM_LIMIT:
        raise ValueError("A parked cover must stay on the pasteboard.")


def round_cover_layout(cover: object) -> object:
    """Round layout numbers by edges, so touching covers stay touching and never overlap."""
    if not isinstance(cover, dict):
        return cover
    rounded = dict(cover)

    def is_number(value: object) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    for start, size in (("x", "width"), ("y", "height")):
        if is_number(cover.get(start)) and is_number(cover.get(size)):
            low = round(cover[start], LAYOUT_DECIMALS)
            high = round(cover[start] + cover[size], LAYOUT_DECIMALS)
            rounded[start] = low
            rounded[size] = round(high - low, LAYOUT_DECIMALS)
    for axis in ("crop_x", "crop_y"):
        if is_number(cover.get(axis)):
            rounded[axis] = round(cover[axis], LAYOUT_DECIMALS)
    return rounded


def locked(method):
    """Serialize repository writes so concurrent builder requests cannot interleave."""
    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)
    return wrapper


def home_cover_layout(cover: dict) -> dict:
    return {key: cover.get(key) for key in ("x", "y", "width", "height")}


def validate_home_gallery_references(config: dict, projects: list[dict]) -> None:
    selected = {
        (project["slug"], image["file"])
        for project in projects
        for image in project["metadata"].get("images", [])
        if image.get("cover") is True
    }
    configured = {
        (cover["project"], cover["file"])
        for cover in config["home_gallery"]["covers"]
    }
    if configured != selected:
        missing = sorted(selected - configured)
        stale = sorted(configured - selected)
        details = []
        if missing:
            details.append(f"missing selected covers: {missing}")
        if stale:
            details.append(f"covers no longer selected: {stale}")
        raise ValueError("Home gallery cover list is out of sync (" + "; ".join(details) + ").")


def sync_project_covers(covers: list[dict], slug: str, images: list[dict]) -> list[dict]:
    """Keep home covers in step with a project's `cover: true` images; new covers go below the rest."""
    selected_files = {image["file"] for image in images if image.get("cover") is True}
    retained = [
        cover for cover in covers
        if cover["project"] != slug or cover["file"] in selected_files
    ]
    existing = {(cover["project"], cover["file"]) for cover in retained}
    for image in images:
        identifier = (slug, image["file"])
        if image.get("cover") is True and identifier not in existing:
            layout_y = max(
                (cover["y"] + cover["height"] for cover in retained if not cover.get("parked")),
                default=0,
            )
            retained.append({
                "project": slug,
                "file": image["file"],
                "x": 0,
                "y": layout_y,
                "width": 6,
                "height": 4,
                "crop": False,
                "crop_x": 50,
                "crop_y": 50,
            })
            existing.add(identifier)
    return [round_cover_layout(cover) for cover in retained]


def convert_upload(filename: str, content: bytes) -> bytes:
    """Validate an uploaded image and return it as color-managed WebP, keeping animation."""
    filename = validate_image_name(filename)
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be non-empty and no larger than 30 MB.")

    expected_format = IMAGE_EXTENSIONS[Path(filename).suffix.lower()]
    try:
        with Image.open(BytesIO(content)) as probe:
            if probe.format != expected_format:
                raise ValueError("The image contents do not match the filename extension.")
            if probe.width * probe.height > MAX_IMAGE_PIXELS:
                raise ValueError("Image dimensions exceed the 80-megapixel upload limit.")
            if getattr(probe, "n_frames", 1) > MAX_ANIMATED_FRAMES:
                raise ValueError(f"Animated images may contain at most {MAX_ANIMATED_FRAMES} frames.")
            probe.verify()

        with Image.open(BytesIO(content)) as image:
            frame_count = getattr(image, "n_frames", 1)
            durations = []
            frames = []
            for frame_index in range(frame_count):
                image.seek(frame_index)
                durations.append(image.info.get("duration", 100))
                frame = color_manage_image(ImageOps.exif_transpose(image.copy()))
                frame.thumbnail(
                    (UPLOAD_MAX_DIMENSION, UPLOAD_MAX_DIMENSION),
                    Image.Resampling.LANCZOS,
                )
                frames.append(frame)
            loop = image.info.get("loop", 0)
    except Image.DecompressionBombError as error:
        raise ValueError("Image dimensions exceed the upload limit.") from error
    except ImageCms.PyCMSError as error:
        raise ValueError(f"Could not convert the embedded color profile: {error}") from error

    output = BytesIO()
    frames[0].save(
        output,
        "WEBP",
        save_all=len(frames) > 1,
        append_images=frames[1:],
        duration=durations if len(frames) > 1 else durations[0],
        loop=loop,
        quality=UPLOAD_WEBP_QUALITY,
        method=6,
        icc_profile=frames[0].info["icc_profile"],
    )
    return output.getvalue()


def available_filename(directory: Path, stem: str, suffix: str) -> str:
    """Return `stem.suffix`, or `stem-2.suffix`, `stem-3.suffix`... if it is taken."""
    candidate = f"{stem}{suffix}"
    counter = 2
    while (directory / candidate).exists():
        candidate = f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def dump_config(config: dict) -> str:
    return yaml.dump(
        preserve_config_styles(config),
        Dumper=SiteConfigDumper,
        allow_unicode=True,
        sort_keys=False,
        width=100,
    )


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(text)
        temporary_path.replace(path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def atomic_write_bytes(path: Path, content: bytes) -> None:
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".upload",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
        temporary_path.replace(path)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


@dataclass
class SiteRepository:
    root: Path
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False, compare=False)

    @property
    def config_path(self) -> Path:
        return self.root / "_config.yml"

    @property
    def projects_path(self) -> Path:
        return self.root / "projects"

    def project_path(self, slug: str) -> Path:
        return self.projects_path / validate_slug(slug) / "index.md"

    def project_directory(self, slug: str) -> Path:
        root = self.root.resolve()
        projects = self.projects_path.resolve()
        if not projects.is_relative_to(root):
            raise ValueError("Projects directory must stay inside the repository.")
        directory = self.project_path(slug).parent.resolve()
        if not directory.is_relative_to(projects):
            raise ValueError("Project directory must stay inside the projects folder.")
        return directory

    def read_config(self) -> dict:
        if not self.config_path.resolve().is_relative_to(self.root.resolve()):
            raise ValueError("Site configuration must stay inside the repository.")
        config = yaml.safe_load(self.config_path.read_text(encoding="utf-8"))
        if not isinstance(config, dict):
            raise ValueError("_config.yml must contain a YAML object.")
        return config

    def list_projects(self) -> list[dict]:
        projects = []
        for project_file in sorted(self.projects_path.glob("*/index.md")):
            slug = project_file.parent.name
            project_directory = self.project_directory(slug)
            project_file = project_directory / "index.md"
            if not project_file.resolve().is_relative_to(project_directory):
                raise ValueError(f"Project metadata must stay inside its directory: {slug}")
            metadata, content = parse_project(project_file.read_text(encoding="utf-8"))
            projects.append({
                "slug": slug,
                "metadata": metadata,
                "content": content,
                "files": sorted(
                    path.name for path in project_file.parent.iterdir()
                    if path.is_file() and path.name != "index.md"
                    and path.suffix.lower() in IMAGE_EXTENSIONS
                ),
                "versions": {
                    path.name: path.stat().st_mtime_ns for path in project_file.parent.iterdir()
                    if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
                },
            })
        return projects

    def state(self) -> dict:
        return {"config": self.read_config(), "projects": self.list_projects()}

    @locked
    def save_config(self, config: dict) -> None:
        if not isinstance(config, dict):
            raise ValueError("Site settings must be an object.")
        home_gallery = config.get("home_gallery")
        if isinstance(home_gallery, dict) and isinstance(home_gallery.get("covers"), list):
            home_gallery["covers"] = [round_cover_layout(cover) for cover in home_gallery["covers"]]
        validate_home_gallery(config)
        validate_home_gallery_references(config, self.list_projects())
        atomic_write(self.config_path, dump_config(config))

    @locked
    def save_home_gallery(self, covers: list[dict]) -> list[dict]:
        config = self.read_config()
        config["home_gallery"]["covers"] = covers
        self.save_config(config)
        return config["home_gallery"]["covers"]

    @locked
    def create_project(self, slug: str, title: str) -> dict:
        slug = validate_slug(slug)
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Project title is required.")
        project_directory = self.project_directory(slug)
        project_file = project_directory / "index.md"
        if project_file.exists():
            raise ConflictError("A project with this slug already exists.")
        project_directory.mkdir(parents=True, exist_ok=True)
        metadata = {
            "layout": "project",
            "title": title.strip(),
            "description": "",
            "permalink": f"/projects/{slug}/",
            "images": [],
        }
        atomic_write(project_file, serialize_project(metadata, ""))
        return {"slug": slug, "metadata": metadata, "content": "", "files": []}

    def _prepare_project(self, slug: str, metadata: dict, content: str) -> tuple[Path, str]:
        """Validate a project edit and return its file and serialized text."""
        project_directory = self.project_directory(slug)
        project_file = project_directory / "index.md"
        if not project_file.is_file():
            raise NotFoundError("Project does not exist.")
        if not project_file.resolve().is_relative_to(project_directory):
            raise ValueError("Project metadata must stay inside its directory.")
        if not isinstance(metadata, dict):
            raise ValueError("Project metadata must be an object.")
        if metadata.get("layout") != "project":
            raise ValueError("Project layout must remain 'project'.")
        if not isinstance(metadata.get("title"), str) or not metadata["title"].strip():
            raise ValueError("Project title is required.")
        if not isinstance(content, str):
            raise ValueError("Project description must be text.")

        images = metadata.get("images", [])
        if not isinstance(images, list):
            raise ValueError("Project images must be a list.")
        for image in images:
            if not isinstance(image, dict):
                raise ValueError("Each project image must be an object.")
            filename = validate_image_name(image.get("file", ""))
            if not isinstance(image.get("alt"), str) or not image["alt"].strip():
                raise ValueError(f"Image {filename} needs non-empty alt text.")
            image_path = (project_directory / filename).resolve()
            if not image_path.is_relative_to(project_directory) or not image_path.is_file():
                raise ValueError(f"Image file does not exist: {filename}")
        metadata["title"] = metadata["title"].strip()
        return project_file, serialize_project(metadata, content)

    def _write_files(self, files: dict[Path, str]) -> None:
        """Write several text files, restoring every previous version if any write fails."""
        previous = {path: path.read_text(encoding="utf-8") for path in files if path.is_file()}
        written = []
        try:
            for path, text in files.items():
                atomic_write(path, text)
                written.append(path)
        except BaseException:
            for path in written:
                if path in previous:
                    atomic_write(path, previous[path])
                else:
                    path.unlink(missing_ok=True)
            raise

    @locked
    def save_project(self, slug: str, metadata: dict, content: str) -> list[dict]:
        project_file, project_text = self._prepare_project(slug, metadata, content)
        config = self.read_config()
        config["home_gallery"]["covers"] = sync_project_covers(
            config["home_gallery"]["covers"], slug, metadata.get("images", []),
        )
        validate_home_gallery(config)
        projects = [project for project in self.list_projects() if project["slug"] != slug]
        projects.append({"slug": slug, "metadata": metadata})
        validate_home_gallery_references(config, projects)
        self._write_files({project_file: project_text, self.config_path: dump_config(config)})
        return config["home_gallery"]["covers"]

    @locked
    def save_all(self, config: dict, projects: list[dict]) -> dict:
        """Save site settings and any edited projects together, all or nothing."""
        if not isinstance(config, dict):
            raise ValueError("Site settings must be an object.")
        if not isinstance(projects, list):
            raise ValueError("Projects must be a list.")
        files = {}
        edited = {}
        for project in projects:
            if not isinstance(project, dict):
                raise ValueError("Each project must be an object.")
            slug = validate_slug(project.get("slug", ""))
            metadata = project.get("metadata")
            project_file, project_text = self._prepare_project(slug, metadata, project.get("content", ""))
            files[project_file] = project_text
            edited[slug] = metadata
        home_gallery = config.get("home_gallery")
        if not isinstance(home_gallery, dict) or not isinstance(home_gallery.get("covers"), list):
            raise ValueError("home_gallery.covers must be a list.")
        covers = [round_cover_layout(cover) for cover in home_gallery["covers"]]
        for slug, metadata in edited.items():
            covers = sync_project_covers(covers, slug, metadata.get("images", []))
        home_gallery["covers"] = covers
        validate_home_gallery(config)
        all_projects = [
            {"slug": project["slug"], "metadata": edited.get(project["slug"], project["metadata"])}
            for project in self.list_projects()
        ]
        validate_home_gallery_references(config, all_projects)
        files[self.config_path] = dump_config(config)
        self._write_files(files)
        return self.state()

    @locked
    def delete_project(self, slug: str) -> dict:
        """Move a project folder to the ignored trash and drop its home covers."""
        project_directory = self.project_directory(slug)
        if not (project_directory / "index.md").is_file():
            raise NotFoundError("Project does not exist.")
        config = self.read_config()
        config["home_gallery"]["covers"] = [
            cover for cover in config["home_gallery"]["covers"] if cover["project"] != slug
        ]
        trash = self.root / TRASH_DIRECTORY
        trash.mkdir(exist_ok=True)
        destination = trash / f"{slug}-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.move(str(project_directory), str(destination))
        try:
            atomic_write(self.config_path, dump_config(config))
        except BaseException:
            shutil.move(str(destination), str(project_directory))
            raise
        return self.state()

    @locked
    def save_image(self, slug: str, filename: str, content: bytes) -> str:
        project_directory = self.project_directory(slug)
        if not project_directory.is_dir():
            raise NotFoundError("Project does not exist.")
        converted = convert_upload(filename, content)
        optimized_filename = available_filename(project_directory, normalize_upload_stem(filename), ".webp")
        atomic_write_bytes(project_directory / optimized_filename, converted)
        return optimized_filename

    @locked
    def save_portrait(self, filename: str, content: bytes) -> str:
        """Store a new artist portrait under assets/images and return its site path."""
        converted = convert_upload(filename, content)
        directory = self.root / SITE_IMAGES_DIRECTORY
        directory.mkdir(parents=True, exist_ok=True)
        portrait_filename = available_filename(directory, f"portrait-{normalize_upload_stem(filename)}", ".webp")
        atomic_write_bytes(directory / portrait_filename, converted)
        return f"/{SITE_IMAGES_DIRECTORY.as_posix()}/{portrait_filename}"

    def read_site_image(self, site_path: str) -> tuple[bytes, str]:
        """Read an image under assets/images by its site path, e.g. /assets/images/avatar.png."""
        directory = (self.root / SITE_IMAGES_DIRECTORY).resolve()
        filename = validate_image_name(Path(site_path or "").name)
        if site_path.lstrip("/") != f"{SITE_IMAGES_DIRECTORY.as_posix()}/{filename}":
            raise NotFoundError("Only images under /assets/images can be shown.")
        path = (directory / filename).resolve()
        if not path.is_relative_to(directory) or not path.is_file():
            raise NotFoundError("Image file does not exist.")
        return path.read_bytes(), mimetypes.guess_type(filename)[0] or "application/octet-stream"

    def _image_path(self, slug: str, filename: str) -> Path:
        filename = validate_image_name(filename)
        directory = self.project_directory(slug)
        resolved_image = (directory / filename).resolve()
        if not resolved_image.is_relative_to(directory) or not resolved_image.is_file():
            raise NotFoundError("Image file does not exist.")
        return resolved_image

    def read_image(self, slug: str, filename: str) -> tuple[bytes, str]:
        image_path = self._image_path(slug, filename)
        return image_path.read_bytes(), mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"

    def read_thumbnail(self, slug: str, filename: str, width: int) -> tuple[bytes, str]:
        """A small color-managed WebP preview for the builder, cached on disk by file version."""
        if width not in THUMBNAIL_WIDTHS:
            raise ValueError(f"Preview width must be one of {THUMBNAIL_WIDTHS}.")
        image_path = self._image_path(slug, filename)
        version = image_path.stat().st_mtime_ns
        cached = self.root / THUMBNAIL_DIRECTORY / slug / f"{image_path.name}.{width}.{version}.webp"
        if not cached.is_file():
            with Image.open(image_path) as image:
                preview = color_manage_image(ImageOps.exif_transpose(image))
            preview.thumbnail((width, width), Image.Resampling.LANCZOS)
            output = BytesIO()
            preview.save(output, "WEBP", quality=82, method=4, icc_profile=preview.info.get("icc_profile"))
            cached.parent.mkdir(parents=True, exist_ok=True)
            for stale in cached.parent.glob(f"{image_path.name}.{width}.*.webp"):
                stale.unlink(missing_ok=True)
            atomic_write_bytes(cached, output.getvalue())
        return cached.read_bytes(), "image/webp"

    def build_site(self) -> str:
        commands = (
            [sys.executable, "-m", "scripts.generate_image_variants"],
            ["bundle", "exec", "jekyll", "build"],
            [sys.executable, "-m", "scripts.prune_unused_assets", "--site-dir", "_site"],
        )
        output = []
        for command in commands:
            try:
                result = subprocess.run(
                    command,
                    cwd=self.root,
                    capture_output=True,
                    text=True,
                    timeout=300,
                    check=False,
                )
            except FileNotFoundError as error:
                raise BuildError(f"Build tool is unavailable: {error.filename}") from error
            except subprocess.TimeoutExpired as error:
                raise BuildError(f"Build timed out while running {' '.join(command)}.") from error
            command_output = "\n".join(part for part in (result.stdout, result.stderr) if part)
            output.append(command_output)
            if result.returncode:
                detail = command_output[-3000:].strip()
                raise BuildError(f"{' '.join(command)} failed:\n{detail}")
        return "\n".join(output)[-3000:]


class BuilderServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        repository: SiteRepository,
        preview_url: str = "http://127.0.0.1:8766/",
    ) -> None:
        self.repository = repository
        self.preview_url = preview_url
        super().__init__(address, BuilderHandler)


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], repository: SiteRepository) -> None:
        self.repository = repository
        super().__init__(address, PreviewHandler)


class BuilderHandler(BaseHTTPRequestHandler):
    server: BuilderServer

    def do_GET(self) -> None:
        if not self._check_local_request():
            return
        url = urlsplit(self.path)
        path = unquote(url.path)
        try:
            image_match = re.fullmatch(r"/api/projects/([^/]+)/images/([^/]+)", path)
            query = parse_qs(url.query)
            # A versioned URL never changes its content, so the browser may keep it.
            cache = "private, max-age=31536000, immutable" if query.get("v") else "no-store"
            if image_match and query.get("w"):
                width = int(query["w"][0]) if query["w"][0].isdigit() else 0
                self._send_bytes(*self.server.repository.read_thumbnail(*image_match.groups(), width), cache=cache)
            elif image_match:
                self._send_bytes(*self.server.repository.read_image(*image_match.groups()), cache=cache)
            elif path == "/api/site-image":
                site_path = parse_qs(url.query).get("path", [""])[0]
                self._send_bytes(*self.server.repository.read_site_image(site_path))
            elif path == "/api/status":
                self._send_json(200, {"outdated": source_fingerprint() != STARTED_FINGERPRINT})
            elif path == "/api/state":
                self._send_json(200, self.server.repository.state())
            elif path in STATIC_FILES:
                filename, content_type = STATIC_FILES[path]
                self._send_bytes((BUILDER_DIR / filename).read_bytes(), content_type)
            else:
                raise NotFoundError("Page not found.")
        except BuilderError as error:
            self._send_error(error)
        except (OSError, ValueError, yaml.YAMLError) as error:
            self._send_error(BuilderError(str(error)))

    def do_POST(self) -> None:
        if not self._check_local_request():
            return
        path = urlsplit(self.path).path
        try:
            payload = self._read_json()
            if path == "/api/save":
                state = self.server.repository.save_all(payload.get("config"), payload.get("projects", []))
                self._send_json(200, state)
            elif path == "/api/projects":
                project = self.server.repository.create_project(
                    payload.get("slug", ""),
                    payload.get("title", ""),
                )
                self._send_json(201, project)
            elif path == "/api/build":
                output = self.server.repository.build_site()
                self._send_json(
                    200,
                    {"ok": True, "preview_url": self.server.preview_url, "output": output},
                )
            else:
                raise NotFoundError("API endpoint not found.")
        except BuilderError as error:
            self._send_error(error)
        except (OSError, ValueError, yaml.YAMLError) as error:
            self._send_error(BuilderError(str(error)))

    def do_PUT(self) -> None:
        if not self._check_local_request():
            return
        path = unquote(urlsplit(self.path).path)
        try:
            image_match = re.fullmatch(r"/api/projects/([^/]+)/images/([^/]+)", path)
            portrait_match = re.fullmatch(r"/api/portrait/([^/]+)", path)
            if not image_match and not portrait_match:
                raise NotFoundError("API endpoint not found.")
            length = self._content_length(MAX_IMAGE_BYTES)
            content = self.rfile.read(length)
            if len(content) != length:
                raise ValueError("Incomplete image upload.")
            if image_match:
                filename = self.server.repository.save_image(*image_match.groups(), content)
                version = (self.server.repository.project_directory(image_match.group(1)) / filename).stat().st_mtime_ns
                self._send_json(201, {"ok": True, "file": filename, "version": version})
            else:
                portrait = self.server.repository.save_portrait(portrait_match.group(1), content)
                self._send_json(201, {"ok": True, "portrait": portrait})
        except BuilderError as error:
            self._send_error(error)
        except (OSError, ValueError, yaml.YAMLError) as error:
            self._send_error(BuilderError(str(error)))

    def do_DELETE(self) -> None:
        if not self._check_local_request():
            return
        path = unquote(urlsplit(self.path).path)
        try:
            project_match = re.fullmatch(r"/api/projects/([^/]+)", path)
            if not project_match:
                raise NotFoundError("API endpoint not found.")
            self._send_json(200, self.server.repository.delete_project(project_match.group(1)))
        except BuilderError as error:
            self._send_error(error)
        except (OSError, ValueError, yaml.YAMLError) as error:
            self._send_error(BuilderError(str(error)))

    def _send_bytes(self, content: bytes, content_type: str, cache: str = "no-store") -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def _check_local_request(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]").lower()
        if host not in {"127.0.0.1", "localhost"}:
            self._send_error(BuilderError("The builder accepts requests from localhost only."))
            return False
        origin = self.headers.get("Origin")
        if origin:
            try:
                parsed_origin = urlsplit(origin)
                origin_host = parsed_origin.hostname
                origin_port = parsed_origin.port
            except ValueError:
                self._send_error(BuilderError("Invalid request origin."))
                return False
            if (
                origin_host not in {"127.0.0.1", "localhost"}
                or origin_port != self.server.server_port
            ):
                self._send_error(BuilderError("Cross-origin requests are not allowed."))
                return False
        return True

    def _content_length(self, maximum: int) -> int:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError as error:
            raise ValueError("Content-Length header is required.") from error
        if length < 0 or length > maximum:
            raise ValueError("Request body is too large.")
        return length

    def _read_json(self) -> dict:
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Requests must use application/json.")
        length = self._content_length(MAX_JSON_BYTES)
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request body must contain valid JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def _send_json(self, status: int, payload: dict) -> None:
        content = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def _send_error(self, error: BuilderError) -> None:
        self._send_json(error.status, {"error": str(error)})

    def log_message(self, format_string: str, *args: object) -> None:
        super().log_message(format_string, *args)


class PreviewHandler(BaseHTTPRequestHandler):
    server: PreviewServer

    def do_GET(self) -> None:
        site_directory = (self.server.repository.root / "_site").resolve()
        if not site_directory.is_relative_to(self.server.repository.root.resolve()):
            self._send_not_found()
            return

        request_path = unquote(urlsplit(self.path).path)
        target = (site_directory / request_path.lstrip("/")).resolve()
        if not target.is_relative_to(site_directory):
            self._send_not_found()
            return
        if target.is_dir():
            if not request_path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", f"{request_path}/")
                self.end_headers()
                return
            target = (target / "index.html").resolve()
        if not target.is_relative_to(site_directory) or not target.is_file():
            self._send_not_found()
            return

        try:
            content = target.read_bytes()
        except OSError as error:
            self._send_not_found()
            self.log_error("Could not read preview file %s: %s", target, error)
            return
        self.send_response(200)
        self.send_header(
            "Content-Type",
            mimetypes.guess_type(target.name)[0] or "application/octet-stream",
        )
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def _send_not_found(self) -> None:
        self.send_error(404, "Preview file not found.")

    def log_message(self, format_string: str, *args: object) -> None:
        super().log_message(format_string, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local portfolio site builder.")
    parser.add_argument("--port", type=int, default=8765, help="Local port (default: 8765)")
    port = parser.parse_args().port
    if not 1 <= port <= 65535:
        parser.error("--port must be between 1 and 65535")

    repository = SiteRepository(ROOT)
    preview_server = PreviewServer(("127.0.0.1", 0), repository)
    preview_thread = threading.Thread(target=preview_server.serve_forever, daemon=True)
    preview_thread.start()
    preview_url = f"http://127.0.0.1:{preview_server.server_port}/"
    try:
        server = BuilderServer(("127.0.0.1", port), repository, preview_url)
    except OSError:
        preview_server.shutdown()
        preview_server.server_close()
        preview_thread.join(timeout=2)
        raise
    print(f"Site builder running at http://127.0.0.1:{port} (Ctrl+C to stop)")
    print(f"Built-site preview will be served at {preview_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping site builder.")
    finally:
        server.server_close()
        preview_server.shutdown()
        preview_server.server_close()
        preview_thread.join(timeout=2)


if __name__ == "__main__":
    main()
