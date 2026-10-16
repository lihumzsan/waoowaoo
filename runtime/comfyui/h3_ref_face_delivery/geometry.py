"""KJ v2 integer center-crop geometry, followed by pixel-center affine resize."""

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class CropGeometry:
    output_width: int
    output_height: int
    source_crop_xywh: tuple[int, int, int, int]

    def project_box(self, box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        if len(box) != 4 or not all(math.isfinite(value) for value in box):
            raise ValueError("Crop box must contain four finite boundary coordinates")
        if box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError("Crop box must have positive area")
        x, y, width, height = self.source_crop_xywh
        return ((box[0] - x) * self.output_width / width,
                (box[1] - y) * self.output_height / height,
                (box[2] - x) * self.output_width / width,
                (box[3] - y) * self.output_height / height)

    def source_center(self, output_x: int, output_y: int) -> tuple[float, float]:
        """Return source boundary coordinates at a delivery pixel center."""
        x, y, width, height = self.source_crop_xywh
        return (x + (output_x + 0.5) * width / self.output_width,
                y + (output_y + 0.5) * height / self.output_height)


def center_crop_geometry(source_width: int, source_height: int,
                         target_width: int, target_height: int) -> CropGeometry:
    for name, value in (("source_width", source_width), ("source_height", source_height),
                        ("target_width", target_width), ("target_height", target_height)):
        if type(value) is not int or value < 1 or value > 16384:
            raise ValueError(f"{name} must be an integer in [1, 16384]")
    width = target_width - target_width % 32
    height = target_height - target_height % 32
    if width < 32 or height < 32:
        raise ValueError("Target dimensions must remain positive after divisible_by=32")
    # This order and Python round are KJ's crop contract, including odd remainders.
    aspect = width / height
    if source_width / source_height > aspect:
        crop_width, crop_height = round(source_height * aspect), source_height
    else:
        crop_width, crop_height = source_width, round(source_width / aspect)
    if crop_width < 1 or crop_height < 1:
        raise ValueError("KJ integer crop has no pixels")
    return CropGeometry(width, height, ((source_width - crop_width) // 2,
                                       (source_height - crop_height) // 2,
                                       crop_width, crop_height))
