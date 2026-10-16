"""Bind only the installed KJ/T8 registry entries and their audited contracts."""

from collections.abc import Callable
from dataclasses import dataclass
import importlib
import inspect
from types import ModuleType


@dataclass(frozen=True)
class Dependencies:
    resize: Callable[..., object]
    parity: ModuleType


def _require_signature(function: object, parameters: tuple[str, ...], name: str) -> None:
    if not callable(function) or tuple(inspect.signature(function).parameters) != parameters:
        raise RuntimeError(f"Unsupported installed dependency contract: {name}{parameters}")


def resolve_dependencies() -> Dependencies:
    import nodes

    registry = nodes.NODE_CLASS_MAPPINGS
    kj_class = registry.get("ImageResizeKJv2")
    t8_class = registry.get("MiniMaxH3FaceRefineParityStitchT8Advanced")
    if kj_class is None or t8_class is None:
        raise RuntimeError("WaoH3RefFaceDeliveryV1 requires loaded ImageResizeKJv2 and T8 ParityStitch")
    kj_resize = getattr(kj_class(), "resize", None)
    _require_signature(kj_resize, ("image", "width", "height", "keep_proportion", "upscale_method",
                                  "divisible_by", "pad_color", "crop_position", "unique_id",
                                  "device", "mask", "per_batch"), "ImageResizeKJv2.resize")
    module_name = t8_class.__module__
    if module_name.split(".")[-2:] != ["h3_t8", "nodes_face_refine_parity_advanced"]:
        raise RuntimeError(f"Unsupported T8 node module: {module_name}")
    parity = importlib.import_module(module_name.rsplit(".", 1)[0] + ".face_refine_parity_advanced")
    if getattr(parity, "PARITY_PLAN_SCHEMA", None) != "h3_t8_face_refine_parity_plan/v1":
        raise RuntimeError("Unsupported installed T8 parity-plan schema")
    signatures = {
        "_validate_parity_plan": ("plan",),
        "source_proxy_sha256": ("frames",),
        "align_frame_count": ("frame_count",),
        "_parity_canvas_mask": ("record", "canvas", "paste_region", "mask_dilation",
                                "feather_source_px", "device", "feather_canvas_override"),
        "_warp_crop_to_source": ("crop", "alpha", "crop_box", "output_height", "output_width"),
        "_source_space_colour_match": ("refined", "original", "alpha", "strength"),
    }
    for name, parameters in signatures.items():
        _require_signature(getattr(parity, name, None), parameters, f"T8.{name}")
    if not callable(kj_resize):
        raise RuntimeError("Missing KJ resize entry")
    return Dependencies(kj_resize, parity)
