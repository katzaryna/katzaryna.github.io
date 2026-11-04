#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import mimetypes
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
from urllib.parse import unquote, urlsplit

from PIL import Image
import yaml


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


def normalize_cover_orders(images: list[dict]) -> None:
    covers = [
        (index, image)
        for index, image in enumerate(images)
        if image.get("cover") is True
    ]

    def order_key(item: tuple[int, dict]) -> tuple[int, int]:
        index, image = item
        order = image.get("gallery_order")
        if isinstance(order, int) and not isinstance(order, bool) and order > 0:
            return -order, index
        return 0, index

    for order, (_, image) in enumerate(sorted(covers, key=order_key), start=1):
        image["gallery_order"] = len(covers) - order + 1


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
    excluded = config.get("exclude")
    if (
        not isinstance(excluded, list)
        or any(not isinstance(item, str) for item in excluded)
        or "site-builder" not in excluded
    ):
        raise ValueError("Keep site-builder in the Jekyll exclude list so the local editor is not published.")


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
            })
        return projects

    def state(self) -> dict:
        return {"config": self.read_config(), "projects": self.list_projects()}

    def save_config(self, config: dict) -> None:
        if not isinstance(config, dict):
            raise ValueError("Site settings must be an object.")
        validate_home_gallery(config)
        atomic_write(
            self.config_path,
            yaml.dump(
                preserve_config_styles(config),
                Dumper=SiteConfigDumper,
                allow_unicode=True,
                sort_keys=False,
                width=100,
            ),
        )

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

    def save_project(self, slug: str, metadata: dict, content: str) -> None:
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
            if image.get("cover") is True:
                order = image.get("gallery_order")
                if not isinstance(order, int) or isinstance(order, bool) or order < 1:
                    raise ValueError(f"Cover {filename} needs a positive gallery order.")
        cover_orders = [
            image["gallery_order"]
            for image in images
            if image.get("cover") is True
        ]
        if len(cover_orders) != len(set(cover_orders)):
            raise ValueError("Cover gallery_order values must be unique.")

        normalize_cover_orders(images)
        metadata["title"] = metadata["title"].strip()
        atomic_write(project_file, serialize_project(metadata, content))

    def save_image(self, slug: str, filename: str, content: bytes) -> None:
        project_directory = self.project_directory(slug)
        if not project_directory.is_dir():
            raise NotFoundError("Project does not exist.")
        filename = validate_image_name(filename)
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError("Image must be non-empty and no larger than 30 MB.")

        try:
            with Image.open(BytesIO(content)) as image:
                expected_format = IMAGE_EXTENSIONS[Path(filename).suffix.lower()]
                if image.format != expected_format:
                    raise ValueError("The image contents do not match the filename extension.")
                if image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError("Image dimensions exceed the 80-megapixel upload limit.")
                image.verify()
        except Image.DecompressionBombError as error:
            raise ValueError("Image dimensions exceed the upload limit.") from error

        destination = project_directory / filename
        if destination.exists():
            raise ConflictError(f"{filename} already exists in this project.")
        atomic_write_bytes(destination, content)

    def read_image(self, slug: str, filename: str) -> tuple[bytes, str]:
        filename = validate_image_name(filename)
        image_path = self.project_directory(slug) / filename
        resolved_image = image_path.resolve()
        if not resolved_image.is_relative_to(self.project_directory(slug)) or not resolved_image.is_file():
            raise NotFoundError("Image file does not exist.")
        return resolved_image.read_bytes(), mimetypes.guess_type(filename)[0] or "application/octet-stream"

    def build_site(self) -> str:
        commands = (
            [sys.executable, "scripts/generate_image_variants.py"],
            ["jekyll", "build"],
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
        path = unquote(urlsplit(self.path).path)
        image_match = re.fullmatch(r"/api/projects/([^/]+)/images/([^/]+)", path)
        if image_match:
            try:
                content, content_type = self.server.repository.read_image(*image_match.groups())
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(content)
            except BuilderError as error:
                self._send_error(error)
            except (OSError, ValueError) as error:
                self._send_error(BuilderError(str(error)))
            return

        if path == "/api/state":
            try:
                self._send_json(200, self.server.repository.state())
            except (OSError, ValueError, yaml.YAMLError) as error:
                self._send_error(BuilderError(f"Could not read site data: {error}"))
            return

        static_files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/styles.css": ("styles.css", "text/css; charset=utf-8"),
        }
        static_file = static_files.get(path)
        if static_file:
            filename, content_type = static_file
            try:
                content = (BUILDER_DIR / filename).read_bytes()
            except OSError as error:
                self._send_error(BuilderError(f"Could not read builder interface: {error}"))
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(content)
            return

        self._send_error(NotFoundError("Page not found."))

    def do_POST(self) -> None:
        if not self._check_local_request():
            return
        path = urlsplit(self.path).path
        try:
            payload = self._read_json()
            if path == "/api/config":
                self.server.repository.save_config(payload.get("config"))
                self._send_json(200, {"ok": True})
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
                self._send_error(NotFoundError("API endpoint not found."))
        except BuilderError as error:
            self._send_error(error)
        except (OSError, ValueError, yaml.YAMLError) as error:
            self._send_error(BuilderError(str(error)))

    def do_PUT(self) -> None:
        if not self._check_local_request():
            return
        path = unquote(urlsplit(self.path).path)
        image_match = re.fullmatch(r"/api/projects/([^/]+)/images/([^/]+)", path)
        try:
            if image_match:
                length = self._content_length(MAX_IMAGE_BYTES)
                content = self.rfile.read(length)
                if len(content) != length:
                    raise ValueError("Incomplete image upload.")
                self.server.repository.save_image(*image_match.groups(), content)
                self._send_json(201, {"ok": True})
                return

            project_match = re.fullmatch(r"/api/projects/([^/]+)", path)
            if not project_match:
                raise NotFoundError("API endpoint not found.")
            payload = self._read_json()
            self.server.repository.save_project(
                project_match.group(1),
                payload.get("metadata"),
                payload.get("content", ""),
            )
            self._send_json(200, {"ok": True})
        except BuilderError as error:
            self._send_error(error)
        except (OSError, ValueError, yaml.YAMLError) as error:
            self._send_error(BuilderError(str(error)))

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
