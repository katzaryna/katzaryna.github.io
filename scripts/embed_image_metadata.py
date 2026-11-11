#!/usr/bin/env python3
"""Write the artist's rights metadata into every published artwork file.

Runs on the built site (``_site``), after Jekyll has copied the originals and
the generated derivatives, so the files in the repository stay untouched. The
metadata is IPTC/XMP: creator, copyright notice, credit line, web statement,
usage terms, and IPTC "Data Mining" set to "prohibited except for search
engine indexing" (no AI training). It is inserted losslessly: JPEG, PNG and
WebP pixel data are copied byte for byte; any earlier XMP packet is replaced.
GIFs and videos are left as they are.
"""
from __future__ import annotations

import argparse
from html import escape
from pathlib import Path
import struct
import zlib

import yaml


ROOT = Path(__file__).resolve().parent.parent
ARTWORK_DIRECTORIES = ("projects", "assets/optimized")
DATA_MINING = "http://ns.useplus.org/ldf/vocab/DMI-PROHIBITED-EXCEPTSEARCHENGINEINDEXING"
USAGE_TERMS = (
    "All rights reserved. No use for training artificial intelligence or machine-learning models, "
    "and no text and data mining, without the author's written permission (reservation under "
    "Article 4(3) of EU Directive 2019/790)."
)

JPEG_XMP_HEADER = b"http://ns.adobe.com/xap/1.0/\x00"
JPEG_EXTENDED_XMP_HEADER = b"http://ns.adobe.com/xmp/extension/\x00"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_XMP_KEYWORD = b"XML:com.adobe.xmp"
WEBP_FLAG_XMP = 0x04
WEBP_FLAG_ALPHA = 0x10


def xmp_packet(creator: str, url: str) -> bytes:
    creator = escape(creator)
    url = escape(url)
    return f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
    xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/"
    photoshop:Credit="{creator}"
    xmpRights:Marked="True"
    xmpRights:WebStatement="{url}"
    plus:DataMining="{DATA_MINING}">
   <dc:creator><rdf:Seq><rdf:li>{creator}</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© {creator}. All rights reserved.</rdf:li></rdf:Alt></dc:rights>
   <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">{escape(USAGE_TERMS)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
   <plus:Licensor><rdf:Bag><rdf:li rdf:parseType="Resource"><plus:LicensorURL>{url}</plus:LicensorURL></rdf:li></rdf:Bag></plus:Licensor>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="r"?>""".encode()


def jpeg_with_xmp(data: bytes, xmp: bytes) -> bytes:
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG file")
    payload = JPEG_XMP_HEADER + xmp
    if len(payload) + 2 > 0xFFFF:
        raise ValueError("XMP packet is too large for a JPEG segment")
    xmp_segment = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload

    leading, rest = [], []
    position = 2
    while True:
        if position + 4 > len(data) or data[position] != 0xFF:
            raise ValueError("malformed JPEG segment")
        marker = data[position + 1]
        if marker == 0xDA:  # Start of scan: entropy-coded data follows unchanged.
            tail = data[position:]
            break
        length = struct.unpack(">H", data[position + 2:position + 4])[0]
        segment = data[position:position + 2 + length]
        position += 2 + length
        is_xmp = marker == 0xE1 and segment[4:].startswith((JPEG_XMP_HEADER, JPEG_EXTENDED_XMP_HEADER))
        if is_xmp:
            continue
        # XMP goes after the JFIF/EXIF headers, which readers expect first.
        (leading if marker in (0xE0, 0xE1) and not rest else rest).append(segment)
    return b"\xff\xd8" + b"".join(leading) + xmp_segment + b"".join(rest) + tail


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


def png_with_xmp(data: bytes, xmp: bytes) -> bytes:
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    # iTXt: keyword, no compression, no language tag, no translated keyword.
    xmp_chunk = png_chunk(b"iTXt", PNG_XMP_KEYWORD + b"\x00\x00\x00\x00\x00" + xmp)
    output = [PNG_SIGNATURE]
    position = len(PNG_SIGNATURE)
    while position < len(data):
        length = struct.unpack(">I", data[position:position + 4])[0]
        kind = data[position + 4:position + 8]
        chunk = data[position:position + 12 + length]
        position += 12 + length
        if kind == b"iTXt" and chunk[8:].startswith(PNG_XMP_KEYWORD + b"\x00"):
            continue
        output.append(chunk)
        if kind == b"IHDR":
            output.append(xmp_chunk)
    return b"".join(output)


def webp_chunks(data: bytes) -> list[tuple[bytes, bytes]]:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("not a WebP file")
    chunks = []
    position = 12
    end = min(len(data), 8 + struct.unpack("<I", data[4:8])[0])
    while position + 8 <= end:
        kind = data[position:position + 4]
        size = struct.unpack("<I", data[position + 4:position + 8])[0]
        chunks.append((kind, data[position + 8:position + 8 + size]))
        position += 8 + size + (size & 1)
    return chunks


def webp_canvas(kind: bytes, payload: bytes) -> tuple[int, int, bool]:
    """Width, height and alpha of a simple (VP8 or VP8L) WebP image."""
    if kind == b"VP8 " and payload[3:6] == b"\x9d\x01\x2a":
        width, height = struct.unpack("<HH", payload[6:10])
        return width & 0x3FFF, height & 0x3FFF, False
    if kind == b"VP8L" and payload[:1] == b"\x2f":
        bits = struct.unpack("<I", payload[1:5])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1, bool((bits >> 28) & 1)
    raise ValueError("unsupported WebP image data")


def webp_with_xmp(data: bytes, xmp: bytes) -> bytes:
    chunks = [(kind, payload) for kind, payload in webp_chunks(data) if kind != b"XMP "]
    if not chunks:
        raise ValueError("empty WebP file")
    kind, payload = chunks[0]
    if kind == b"VP8X":
        chunks[0] = (kind, bytes([payload[0] | WEBP_FLAG_XMP]) + payload[1:])
    else:
        # A simple file must become an extended one to carry metadata.
        width, height, alpha = webp_canvas(kind, payload)
        flags = WEBP_FLAG_XMP | (WEBP_FLAG_ALPHA if alpha else 0)
        header = bytes([flags, 0, 0, 0]) + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
        chunks.insert(0, (b"VP8X", header))
    chunks.append((b"XMP ", xmp))  # Metadata chunks come last.
    body = b"".join(
        kind + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) & 1 else b"")
        for kind, payload in chunks
    )
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + body


WRITERS = {
    ".jpg": jpeg_with_xmp,
    ".jpeg": jpeg_with_xmp,
    ".png": png_with_xmp,
    ".webp": webp_with_xmp,
}


def site_metadata(config_path: Path = ROOT / "_config.yml") -> tuple[str, str]:
    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    artist = config.get("artist") or {}
    creator = (artist.get("full_name") or artist.get("name") or "").strip()
    url = (config.get("url") or "").strip()
    if not creator:
        raise ValueError("_config.yml needs artist.full_name (or artist.name) for the image metadata.")
    return creator, url


def embed(site_dir: Path, creator: str, url: str) -> int:
    xmp = xmp_packet(creator, url)
    count = 0
    for directory in ARTWORK_DIRECTORIES:
        for path in sorted((site_dir / directory).rglob("*")):
            writer = WRITERS.get(path.suffix.lower())
            if not writer or not path.is_file():
                continue
            try:
                updated = writer(path.read_bytes(), xmp)
            except (ValueError, struct.error) as error:
                raise ValueError(f"{path}: {error}") from error
            # A new file rather than an in-place write, in case the built file
            # is linked to the original artwork.
            temporary = path.with_name(path.name + ".tmp")
            temporary.write_bytes(updated)
            temporary.replace(path)
            count += 1
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--site-dir", type=Path, default=Path("_site"))
    site_dir = parser.parse_args().site_dir
    if not site_dir.is_dir():
        parser.error(f"site directory does not exist: {site_dir}")
    creator, url = site_metadata()
    count = embed(site_dir, creator, url)
    print(f"Embedded rights metadata for {creator} in {count} images.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
