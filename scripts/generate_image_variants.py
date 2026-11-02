#!/usr/bin/env python3
import json
from pathlib import Path
import subprocess
import tomli

from PIL import Image, ImageOps
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "projects"
OUTPUT = ROOT / "assets" / "optimized"
MANIFEST = ROOT / "_data" / "generated_image_variants.json"
CONFIG = tomli.loads((ROOT / "config" / "image_optimization.toml").read_text())
TARGET_WIDTHS = tuple(CONFIG["target_widths"])
WEBP_QUALITY = int(CONFIG["webp_quality"])
PREVIEW_MAX_WIDTH = int(CONFIG["preview_max_width"])
PREVIEW_WEBM_CRF = int(CONFIG["preview_webm_crf"])
PREVIEW_MP4_CRF = int(CONFIG["preview_mp4_crf"])
LIGHTBOX_MAX_WIDTH = int(CONFIG["lightbox_max_width"])
LIGHTBOX_WEBM_CRF = int(CONFIG["lightbox_webm_crf"])
LIGHTBOX_MP4_CRF = int(CONFIG["lightbox_mp4_crf"])
STATIC_FORMATS = {".jpg", ".jpeg", ".png", ".webp"}


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


def create_variants() -> None:
    variants = {}
    expected_files = set()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    for source in sorted(PROJECTS.rglob("*")):
        if not source.is_file() or source.suffix.lower() not in STATIC_FORMATS | {".gif"}:
            continue

        key = source.relative_to(ROOT).as_posix()
        output_directory = OUTPUT / source.relative_to(PROJECTS).parent / source.stem
        with Image.open(source) as opened:
            if source.suffix.lower() == ".gif" and getattr(opened, "n_frames", 1) > 1:
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
                first_frame = ImageOps.exif_transpose(opened.convert("RGBA"))
                poster_width = min(960, first_frame.width)
                poster_height = max(1, round(first_frame.height * poster_width / first_frame.width))
                if poster_width < first_frame.width:
                    first_frame = first_frame.resize(
                        (poster_width, poster_height),
                        Image.Resampling.LANCZOS,
                    )
                first_frame.save(motion_poster, "WEBP", quality=WEBP_QUALITY, method=6)
                expected_files.update(
                    (motion_video, motion_mp4, lightbox_video, lightbox_mp4, motion_poster)
                )
                variants[key] = {
                    "width": opened.width,
                    "height": opened.height,
                    "motion": {
                        "src": "/" + motion_video.relative_to(ROOT).as_posix(),
                        "mp4": "/" + motion_mp4.relative_to(ROOT).as_posix(),
                        "lightbox_src": "/" + lightbox_video.relative_to(ROOT).as_posix(),
                        "lightbox_mp4": "/" + lightbox_mp4.relative_to(ROOT).as_posix(),
                        "poster": "/" + motion_poster.relative_to(ROOT).as_posix(),
                    },
                }
                continue

            if source.suffix.lower() not in STATIC_FORMATS or getattr(opened, "n_frames", 1) != 1:
                continue

            image = ImageOps.exif_transpose(opened)
            width, height = image.size
            candidate_widths = [size for size in TARGET_WIDTHS if size <= width]
            if not candidate_widths:
                candidate_widths = [width]

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
                resized.save(output, "WEBP", quality=WEBP_QUALITY, method=6)
                expected_files.add(output)
                source_variants.append(
                    {
                        "src": "/" + output.relative_to(ROOT).as_posix(),
                        "width": target_width,
                    }
                )

            variants[key] = {
                "src": source_variants[0]["src"],
                "width": width,
                "height": height,
                "landscape": width > height,
                "sources": source_variants,
            }

    for stale_file in OUTPUT.rglob("*") if OUTPUT.exists() else ():
        if not stale_file.is_file() or stale_file.suffix not in {".webp", ".webm", ".mp4"}:
            continue
        if stale_file not in expected_files:
            stale_file.unlink()

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for directory in sorted(OUTPUT.rglob("*"), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(variants, ensure_ascii=False, indent=2) + "\n")
    print(f"Generated responsive variants for {len(variants)} project images.")


if __name__ == "__main__":
    create_variants()
