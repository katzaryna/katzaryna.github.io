from io import BytesIO
from pathlib import Path

from PIL import Image
import pytest

from scripts.embed_image_metadata import DATA_MINING, embed, webp_chunks, xmp_packet


FIXTURES = Path(__file__).parent / "fixtures"


def encode(image: Image.Image, format: str, **options) -> bytes:
    output = BytesIO()
    image.save(output, format, **options)
    return output.getvalue()


def embedded_xmp(data: bytes) -> str:
    with Image.open(BytesIO(data)) as image:
        image.load()  # The pixel data must still decode.
        xmp = image.info.get("xmp") or image.info.get("XML:com.adobe.xmp") or b""
    return xmp.decode() if isinstance(xmp, bytes) else xmp


def picture(mode: str = "RGB") -> Image.Image:
    image = Image.new(mode, (37, 21), (200, 40, 90, 128)[: len(mode)])
    image.putpixel((3, 4), (10, 200, 30, 255)[: len(mode)])
    return image


@pytest.mark.parametrize(
    ("name", "data"),
    [
        ("art.jpg", encode(picture(), "JPEG", quality=90, exif=Image.Exif())),
        ("art.png", encode(picture(), "PNG")),
        ("simple-lossy.webp", encode(picture(), "WEBP", quality=80)),
        ("simple-lossless.webp", encode(picture("RGBA"), "WEBP", lossless=True)),
        ("extended.webp", encode(picture(), "WEBP", quality=80, icc_profile=(FIXTURES / "display-p3.icc").read_bytes())),
    ],
)
def test_metadata_is_embedded_without_touching_the_pixels(tmp_path: Path, name: str, data: bytes) -> None:
    artwork = tmp_path / "projects" / "demo" / name
    artwork.parent.mkdir(parents=True)
    artwork.write_bytes(data)
    with Image.open(BytesIO(data)) as before:
        pixels = before.convert("RGBA").tobytes()
        profile = before.info.get("icc_profile")

    assert embed(tmp_path, "Ann Artist & Co", "https://example.org") == 1
    updated = artwork.read_bytes()

    xmp = embedded_xmp(updated)
    assert DATA_MINING in xmp
    assert "Ann Artist &amp; Co" in xmp
    assert "https://example.org" in xmp
    with Image.open(BytesIO(updated)) as after:
        assert after.convert("RGBA").tobytes() == pixels
        assert after.info.get("icc_profile") == profile

    # A second run replaces the packet instead of adding another one.
    embed(tmp_path, "Ann Artist & Co", "https://example.org")
    assert artwork.read_bytes() == updated


def test_simple_webp_becomes_extended_with_its_canvas_and_alpha(tmp_path: Path) -> None:
    artwork = tmp_path / "assets" / "optimized" / "art.webp"
    artwork.parent.mkdir(parents=True)
    artwork.write_bytes(encode(picture("RGBA"), "WEBP", lossless=True))
    embed(tmp_path, "Ann", "")

    kind, header = webp_chunks(artwork.read_bytes())[0]
    assert kind == b"VP8X"
    assert header[0] == 0x04 | 0x10
    assert int.from_bytes(header[4:7], "little") + 1 == 37
    assert int.from_bytes(header[7:10], "little") + 1 == 21


def test_other_files_and_folders_are_left_alone(tmp_path: Path) -> None:
    gif = tmp_path / "projects" / "demo" / "motion.gif"
    gif.parent.mkdir(parents=True)
    gif.write_bytes(encode(picture(), "GIF"))
    logo = tmp_path / "assets" / "images" / "logo.png"
    logo.parent.mkdir(parents=True)
    logo.write_bytes(encode(picture(), "PNG"))
    before = gif.read_bytes(), logo.read_bytes()

    assert embed(tmp_path, "Ann", "") == 0
    assert (gif.read_bytes(), logo.read_bytes()) == before


def test_packet_names_the_creator_and_reserves_ai_training() -> None:
    packet = xmp_packet("Ann <Artist>", "https://example.org/?a=1&b=2").decode()
    assert "Ann &lt;Artist&gt;" in packet
    assert "https://example.org/?a=1&amp;b=2" in packet
    assert "DMI-PROHIBITED-EXCEPTSEARCHENGINEINDEXING" in packet
    assert "Directive 2019/790" in packet
