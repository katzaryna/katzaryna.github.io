from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageCms


SRGB_PROFILE = ImageCms.createProfile("sRGB")
SRGB_PROFILE_BYTES = ImageCms.ImageCmsProfile(SRGB_PROFILE).tobytes()


def color_manage_image(image: Image.Image) -> Image.Image:
    has_alpha = "A" in image.getbands() or "transparency" in image.info
    alpha = image.convert("RGBA").getchannel("A") if has_alpha else None
    embedded_profile = image.info.get("icc_profile")

    if embedded_profile:
        source_profile = ImageCms.ImageCmsProfile(BytesIO(embedded_profile))
        color_space = source_profile.profile.xcolor_space.strip()
        if color_space == "RGB" and image.mode != "CMYK":
            source = image.convert("RGB")
            converted = source
            output_profile = embedded_profile
        else:
            input_modes = {"CMYK": "CMYK", "GRAY": "L"}
            input_mode = input_modes.get(color_space)
            if not input_mode:
                raise ValueError(f"Unsupported embedded image color profile: {color_space}.")
            converted = ImageCms.profileToProfile(
                image.convert(input_mode),
                source_profile,
                SRGB_PROFILE,
                outputMode="RGB",
            )
            output_profile = SRGB_PROFILE_BYTES
    else:
        converted = image.convert("RGB")
        output_profile = SRGB_PROFILE_BYTES

    if alpha is not None:
        converted.putalpha(alpha)
    converted.info["icc_profile"] = output_profile
    return converted
