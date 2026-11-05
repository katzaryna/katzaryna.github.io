from scripts.generate_image_variants import responsive_widths


def test_responsive_widths_keep_full_source_resolution() -> None:
    targets = (480, 960, 1440)
    assert responsive_widths(300, targets) == [300]
    assert responsive_widths(480, targets) == [480]
    assert responsive_widths(854, targets) == [480, 854]
    assert responsive_widths(1280, targets) == [480, 960, 1280]
    assert responsive_widths(1440, targets) == [480, 960, 1440]
    assert responsive_widths(4000, targets) == [480, 960, 1440]
