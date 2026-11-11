#!/usr/bin/env python3
import base64
import hashlib
from io import BytesIO
import json
from pathlib import Path
import subprocess
import tomli

from PIL import Image, ImageChops, ImageCms, ImageDraw, ImageOps
import yaml
import imageio_ffmpeg

from scripts.embed_image_metadata import site_metadata, xmp_packet
from scripts.image_utils import SRGB_PROFILE, SRGB_PROFILE_BYTES, color_manage_image
from scripts.project_files import unreferenced_images


ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "projects"
OUTPUT = ROOT / "assets" / "optimized"
MANIFEST = ROOT / "_data" / "generated_image_variants.json"
# name -> (size in pixels, background or None for transparent corners)
ICON_SIZES = {"icon_32": (32, None), "icon_192": (192, None), "apple_touch": (180, "#ffffff")}
CACHE = OUTPUT / ".build-cache.json"
CONFIG = tomli.loads((ROOT / "config" / "image_optimization.toml").read_text())
TARGET_WIDTHS = tuple(CONFIG["target_widths"])
WEBP_QUALITY = int(CONFIG["webp_quality"])
AVIF_QUALITY = int(CONFIG["avif_quality"])
PREVIEW_MAX_WIDTH = int(CONFIG["preview_max_width"])
PREVIEW_WEBM_CRF = int(CONFIG["preview_webm_crf"])
PREVIEW_MP4_CRF = int(CONFIG["preview_mp4_crf"])
LIGHTBOX_MAX_WIDTH = int(CONFIG["lightbox_max_width"])
LIGHTBOX_WEBM_CRF = int(CONFIG["lightbox_webm_crf"])
LIGHTBOX_MP4_CRF = int(CONFIG["lightbox_mp4_crf"])
STATIC_FORMATS = {".jpg", ".jpeg", ".png", ".webp"}
PLACEHOLDER_SIZE = 16
PLACEHOLDER_QUALITY = 60


def responsive_widths(source_width: int, target_widths: tuple[int, ...] = TARGET_WIDTHS) -> list[int]:
    """Return derivative widths: every target below the source plus the largest useful width."""
    largest = min(source_width, max(target_widths))
    return sorted({width for width in target_widths if width < largest} | {largest})


def placeholder_data_uri(image: Image.Image) -> str | None:
    """A tiny blurred preview shown while the artwork loads, as an inline data URI.

    Opaque images only: the preview sits behind the image, so it would show
    through transparent areas.
    """
    if "A" in image.getbands() or "transparency" in image.info:
        return None
    preview = image.copy()
    preview.thumbnail((PLACEHOLDER_SIZE, PLACEHOLDER_SIZE), Image.Resampling.LANCZOS)
    profile = image.info.get("icc_profile")
    if profile and profile != SRGB_PROFILE_BYTES:
        # Untagged previews are read as sRGB, so convert wide-gamut colours.
        preview = ImageCms.profileToProfile(
            preview.convert("RGB"), ImageCms.ImageCmsProfile(BytesIO(profile)), SRGB_PROFILE, outputMode="RGB",
        )
    output = BytesIO()
    preview.convert("RGB").save(output, "WEBP", quality=PLACEHOLDER_QUALITY, method=6)
    return "data:image/webp;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def round_icon(portrait: Image.Image, size: int, background: str | None = None) -> Image.Image:
    """The portrait cropped to a circle with smooth edges.

    Browser tabs show the icon as it is, so the corners are transparent. Home-screen
    icons on iPhone get `background`: iOS fills transparent corners with black.
    """
    image = ImageOps.fit(portrait.convert("RGBA"), (size, size), Image.Resampling.LANCZOS)
    oversample = 4
    mask = Image.new("L", (size * oversample, size * oversample), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * oversample - 1, size * oversample - 1), fill=255)
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    image.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    if background:
        tile = Image.new("RGBA", (size, size), background)
        tile.alpha_composite(image)
        image = tile.convert("RGB")
    return image


PORTRAIT_SIZE = 192  # Twice the largest header portrait, for sharp Retina screens.


def create_site_images() -> dict:
    """Images made from the header settings, listed in _data/generated_site_images.json:
    round favicons and a light WebP of the portrait (artist.portrait), with a version
    for cache busting, and the wordmark image's size so the header does not shift."""
    icons_directory = OUTPUT / "icons"
    icon_manifest = MANIFEST.with_name("generated_site_images.json")
    site_config = ROOT / "_config.yml"
    config = yaml.safe_load(site_config.read_text(encoding="utf-8")) if site_config.is_file() else None
    portrait_path = ((config or {}).get("artist") or {}).get("portrait") or ""
    source = (ROOT / portrait_path.lstrip("/")).resolve()
    if not portrait_path or not source.is_relative_to(ROOT.resolve()) or not source.is_file():
        icon_manifest.unlink(missing_ok=True)
        return {}
    with Image.open(source) as opened:
        portrait = color_manage_image(ImageOps.exif_transpose(opened))
    icons_directory.mkdir(parents=True, exist_ok=True)
    version = hashlib.sha256(source.read_bytes() + Path(__file__).read_bytes()).hexdigest()[:10]
    icons = {}
    for name, (size, background) in ICON_SIZES.items():
        output = icons_directory / f"{name.replace('_', '-')}.png"
        round_icon(portrait, size, background).save(output, "PNG", optimize=True)
        icons[name] = "/" + output.relative_to(ROOT).as_posix() + f"?v={version}"

    header_portrait = ImageOps.fit(portrait.convert("RGBA"), (PORTRAIT_SIZE, PORTRAIT_SIZE), Image.Resampling.LANCZOS)
    portrait_output = icons_directory / "portrait.webp"
    header_portrait.save(portrait_output, "WEBP", quality=WEBP_QUALITY, method=6)
    icons["portrait"] = "/" + portrait_output.relative_to(ROOT).as_posix() + f"?v={version}"

    wordmark_path = ((config or {}).get("artist") or {}).get("wordmark_image") or ""
    wordmark = (ROOT / wordmark_path.lstrip("/")).resolve()
    if wordmark_path and wordmark.is_relative_to(ROOT.resolve()) and wordmark.is_file():
        with Image.open(wordmark) as opened:
            icons["wordmark_width"], icons["wordmark_height"] = ImageOps.exif_transpose(opened).size
    icon_manifest.write_text(json.dumps(icons, indent=2) + "\n")
    return icons


def create_animation_videos(
    source: Path,
    output_directory: Path,
    ffmpeg: str,
    maximum_width: int,
    webm_crf: int,
    mp4_crf: int,
    filename_prefix: str = "",
) -> tuple[Path, Path]:
    stem = f"{filename_prefix}animation" if filename_prefix else "animation"
    webm_output = output_directory / f"{stem}.webm"
    mp4_output = output_directory / f"{stem}.mp4"
    output_directory.mkdir(parents=True, exist_ok=True)
    scale_filter = f"scale=w='trunc(min({maximum_width},iw)/2)*2':h=-2:flags=lanczos"

    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-v", "error",
            "-i", str(source),
            "-an",
            "-vf", scale_filter,
            "-c:v", "libvpx-vp9",
            "-crf", str(webm_crf),
            "-b:v", "0",
            "-deadline", "good",
            "-cpu-used", "4",
            "-row-mt", "1",
            "-pix_fmt", "yuv420p",
            str(webm_output),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-v", "error",
            "-i", str(source),
            "-an",
            "-vf", scale_filter,
            "-c:v", "libx264",
            "-crf", str(mp4_crf),
            "-preset", "medium",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(mp4_output),
        ],
        check=True,
    )
    return webm_output, mp4_output


def rights_xmp() -> bytes | None:
    """The artist's rights metadata, written straight into AVIF files
    (embed_image_metadata.py adds it to JPEG, PNG and WebP after the build)."""
    try:
        return xmp_packet(*site_metadata(ROOT / "_config.yml"))
    except (OSError, ValueError):
        return None


def settings_fingerprint() -> str:
    """Anything that changes the output: settings, the code that renders it and the rights metadata."""
    digest = hashlib.sha256()
    for path in (ROOT / "config" / "image_optimization.toml", Path(__file__), Path(__file__).with_name("image_utils.py")):
        digest.update(path.read_bytes())
    digest.update(rights_xmp() or b"")
    return digest.hexdigest()


def source_digest(source: Path, settings: str) -> str:
    digest = hashlib.sha256(settings.encode())
    digest.update(source.read_bytes())
    return digest.hexdigest()


def read_cache() -> dict:
    try:
        cache = json.loads(CACHE.read_text())
    except (OSError, ValueError):
        return {}
    return cache if isinstance(cache, dict) else {}


def build_source(source: Path, key: str, output_directory: Path, ffmpeg: str, variants: dict, expected_files: set,
                 xmp: bytes | None = None) -> None:
    with Image.open(source) as opened:
        if getattr(opened, "n_frames", 1) > 1:
            motion_video = output_directory / "animation.webm"
            motion_mp4 = output_directory / "animation.mp4"
            lightbox_video = output_directory / "lightbox-animation.webm"
            lightbox_mp4 = output_directory / "lightbox-animation.mp4"
            motion_poster = output_directory / "poster.webp"
            motion_video, motion_mp4 = create_animation_videos(
                source,
                motion_video.parent,
                ffmpeg,
                PREVIEW_MAX_WIDTH,
                PREVIEW_WEBM_CRF,
                PREVIEW_MP4_CRF,
            )
            lightbox_video, lightbox_mp4 = create_animation_videos(
                source,
                lightbox_video.parent,
                ffmpeg,
                LIGHTBOX_MAX_WIDTH,
                LIGHTBOX_WEBM_CRF,
                LIGHTBOX_MP4_CRF,
                filename_prefix="lightbox-",
            )

            opened.seek(0)
            first_frame = color_manage_image(ImageOps.exif_transpose(opened.copy()))
            poster_width = min(960, first_frame.width)
            poster_height = max(1, round(first_frame.height * poster_width / first_frame.width))
            if poster_width < first_frame.width:
                first_frame = first_frame.resize(
                    (poster_width, poster_height),
                    Image.Resampling.LANCZOS,
                )
            first_frame.save(
                motion_poster,
                "WEBP",
                quality=WEBP_QUALITY,
                method=6,
                icc_profile=first_frame.info["icc_profile"],
            )
            expected_files.update(
                (motion_video, motion_mp4, lightbox_video, lightbox_mp4, motion_poster)
            )
            placeholder = placeholder_data_uri(first_frame)
            variants[key] = {
                "width": opened.width,
                "height": opened.height,
                **({"placeholder": placeholder} if placeholder else {}),
                "motion": {
                    "src": "/" + motion_video.relative_to(ROOT).as_posix(),
                    "mp4": "/" + motion_mp4.relative_to(ROOT).as_posix(),
                    "lightbox_src": "/" + lightbox_video.relative_to(ROOT).as_posix(),
                    "lightbox_mp4": "/" + lightbox_mp4.relative_to(ROOT).as_posix(),
                    "poster": "/" + motion_poster.relative_to(ROOT).as_posix(),
                },
            }
            return

        if source.suffix.lower() not in STATIC_FORMATS or getattr(opened, "n_frames", 1) != 1:
            return

        image = color_manage_image(ImageOps.exif_transpose(opened))
        width, height = image.size
        candidate_widths = responsive_widths(width)

        source_variants = []
        for target_width in candidate_widths:
            target_height = max(1, round(height * target_width / width))
            resized = image.resize(
                (target_width, target_height),
                Image.Resampling.LANCZOS,
            )
            if "A" in resized.getbands() or "transparency" in resized.info:
                resized = resized.convert("RGBA")
            else:
                resized = resized.convert("RGB")

            output = output_directory
            output = output / f"{target_width}.webp"
            output.parent.mkdir(parents=True, exist_ok=True)
            resized.save(
                output,
                "WEBP",
                quality=WEBP_QUALITY,
                method=6,
                icc_profile=image.info["icc_profile"],
            )
            # AVIF: about a third of the WebP size at the same visual quality;
            # browsers without it get the WebP.
            avif_output = output.with_suffix(".avif")
            resized.save(
                avif_output,
                "AVIF",
                quality=AVIF_QUALITY,
                speed=6,
                icc_profile=image.info["icc_profile"],
                **({"xmp": xmp} if xmp else {}),
            )
            expected_files.update((output, avif_output))
            source_variants.append(
                {
                    "src": "/" + output.relative_to(ROOT).as_posix(),
                    "avif": "/" + avif_output.relative_to(ROOT).as_posix(),
                    "width": target_width,
                }
            )

        placeholder = placeholder_data_uri(image)
        variants[key] = {
            "src": source_variants[0]["src"],
            "width": width,
            "height": height,
            "sources": source_variants,
            **({"placeholder": placeholder} if placeholder else {}),
        }


def create_variants() -> None:
    variants = {}
    expected_files = set()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    settings = settings_fingerprint()
    xmp = rights_xmp()
    cache = read_cache()
    new_cache = {}
    reused = built = 0

    unused = {
        path
        for project_directory in PROJECTS.iterdir() if project_directory.is_dir()
        for path in unreferenced_images(project_directory)
    }
    for source in sorted(PROJECTS.rglob("*")):
        if not source.is_file() or source.suffix.lower() not in STATIC_FORMATS | {".gif"}:
            continue
        if source in unused:
            continue

        key = source.relative_to(ROOT).as_posix()
        output_directory = OUTPUT / source.relative_to(PROJECTS).parent / source.stem
        digest = source_digest(source, settings)
        cached = cache.get(key)
        if cached and cached["digest"] == digest and all((ROOT / path).is_file() for path in cached["files"]):
            if cached["entry"] is not None:
                variants[key] = cached["entry"]
            expected_files.update(ROOT / path for path in cached["files"])
            new_cache[key] = cached
            reused += 1
            continue
        before = set(expected_files)
        build_source(source, key, output_directory, ffmpeg, variants, expected_files, xmp)
        new_cache[key] = {
            "digest": digest,
            "entry": variants.get(key),
            "files": sorted(path.relative_to(ROOT).as_posix() for path in expected_files - before),
        }
        built += 1

    for stale_file in OUTPUT.rglob("*") if OUTPUT.exists() else ():
        if not stale_file.is_file() or stale_file.suffix not in {".webp", ".avif", ".webm", ".mp4"}:
            continue
        if stale_file not in expected_files:
            stale_file.unlink()

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for directory in sorted(OUTPUT.rglob("*"), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(variants, ensure_ascii=False, indent=2) + "\n")
    create_site_images()
    CACHE.write_text(json.dumps(new_cache, indent=1) + "\n")
    print(f"Responsive variants for {len(variants)} project images: {built} built, {reused} unchanged.")


if __name__ == "__main__":
    create_variants()
