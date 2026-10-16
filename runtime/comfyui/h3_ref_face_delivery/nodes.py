"""Experimental single-track H3 Ref refinement delivered after KJ RTX VSR."""

from __future__ import annotations

from collections.abc import Callable
import json
import math
from types import ModuleType

import torch

from .dependencies import resolve_dependencies
from .geometry import CropGeometry, center_crop_geometry
from .pixels import composite_rgb_in_place


def _mapping(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object with string keys")
    return value


def _integer(value: object, name: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def _number(value: object, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be numeric")
    result = float(value)
    if not math.isfinite(result) or not minimum <= result <= maximum:
        raise ValueError(f"{name} must be finite in [{minimum}, {maximum}]")
    return result


def _box(value: object, name: str, width: int, height: int,
         bounded: bool = True) -> tuple[float, float, float, float]:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{name} must contain four coordinates")
    minimum = 0.0 if bounded else -math.inf
    maximum_x = width if bounded else math.inf
    maximum_y = height if bounded else math.inf
    left = _number(value[0], name, minimum, maximum_x)
    top = _number(value[1], name, minimum, maximum_y)
    right = _number(value[2], name, minimum, maximum_x)
    bottom = _number(value[3], name, minimum, maximum_y)
    if right <= left or bottom <= top:
        raise ValueError(f"{name} must have positive area")
    return left, top, right, bottom


def _validate_images(images: torch.Tensor, name: str, chunk_frames: int,
                     check_interrupted: Callable[[], None] | None = None) -> tuple[int, int, int]:
    if not isinstance(images, torch.Tensor) or images.ndim != 4 or images.shape[-1] != 3:
        raise ValueError(f"{name} must be RGB IMAGE [N,H,W,3]")
    if images.dtype != torch.float32 or images.device.type != "cpu":
        raise ValueError(f"{name} must be CPU FP32; explicit conversion is required upstream")
    count, height, width, _ = map(int, images.shape)
    if count < 1 or height < 2 or width < 2:
        raise ValueError(f"{name} must contain non-empty images")
    for start in range(0, count, chunk_frames):
        if check_interrupted is not None:
            check_interrupted()
        if not bool(torch.isfinite(images[start:start + chunk_frames]).all()):
            raise ValueError(f"{name} contains NaN or Inf")
    return count, height, width


@torch.inference_mode()
def blend_delivery_frame(base: torch.Tensor, refined_crop: torch.Tensor,
                         record: dict[str, object], geometry: CropGeometry,
                         canvas_size: int, feather_canvas: int, paste_region: str,
                         mask_dilation: int, feather_source_px: float,
                         colour_match: float, blend: float, paste_weight: float,
                         parity: ModuleType) -> bool:
    """Write only the caller-owned delivery frame, using the actual T8 helpers.

    The same core supports offline real-pixel review. The caller owns the source
    binding, parameter checks and a fresh output buffer; this function neither
    changes a plan nor substitutes an alternate tracking/mask/color algorithm.
    """
    if paste_weight * blend == 0:
        return False
    source_box = record["source_crop_box_xyxy"]
    if not isinstance(source_box, list) or len(source_box) != 4:
        raise ValueError("Missing source crop box")
    box = tuple(float(value) for value in source_box)
    alpha_canvas = parity._parity_canvas_mask(record, canvas_size, paste_region, mask_dilation,
                                              feather_source_px, torch.device("cpu"), feather_canvas)
    # Compose crop->source and source->KJ crop/resize geometries once. Refined
    # RGB never passes through the low-resolution source raster.
    patch, alpha = parity._warp_crop_to_source(refined_crop, alpha_canvas,
                                               list(geometry.project_box(box)),
                                               geometry.output_height, geometry.output_width)
    patch = parity._source_space_colour_match(patch, base, alpha, colour_match)
    alpha = alpha * paste_weight * blend
    composite_rgb_in_place(base.numpy(), patch.numpy(), alpha.numpy())
    return bool(torch.any(alpha > 0))


@torch.inference_mode()
def resize_delivery_frames(source_frames: torch.Tensor, target_width: int,
                            target_height: int, chunk_frames: int = 4,
                            compose_frame: Callable[[torch.Tensor, int], None] | None = None,
                            unique_id: str | None = None) -> tuple[torch.Tensor, dict[str, object]]:
    """The single final-buffer/KJ chunk loop for face and no-face delivery."""
    from comfy.model_management import throw_exception_if_processing_interrupted

    throw_exception_if_processing_interrupted()
    chunk_frames = _integer(chunk_frames, "chunk_frames", 1)
    if chunk_frames > 32:
        raise ValueError("chunk_frames must be <= 32")
    count, height, width = _validate_images(source_frames, "source_frames", chunk_frames,
                                           throw_exception_if_processing_interrupted)
    geometry = center_crop_geometry(width, height, target_width, target_height)
    resize = resolve_dependencies().resize
    throw_exception_if_processing_interrupted()
    output = torch.empty((count, geometry.output_height, geometry.output_width, 3),
                         dtype=torch.float32, device="cpu")
    for start in range(0, count, chunk_frames):
        throw_exception_if_processing_interrupted()
        end = min(count, start + chunk_frames)
        resized_result = resize(
            image=source_frames[start:end], width=target_width, height=target_height,
            keep_proportion="crop", upscale_method="nvidia_rtx_vsr", divisible_by=32,
            pad_color="0, 0, 0", crop_position="center", unique_id=unique_id,
            device="cpu", mask=None, per_batch=0)
        if not isinstance(resized_result, tuple) or len(resized_result) != 4:
            raise RuntimeError("KJ resize returned an unsupported result contract")
        resized = resized_result[0]
        if not isinstance(resized, torch.Tensor) or tuple(resized.shape) != (end-start, geometry.output_height, geometry.output_width, 3):
            raise RuntimeError("KJ output shape differs from the audited integer crop geometry")
        if resized.dtype != torch.float32 or resized.device.type != "cpu":
            raise RuntimeError("KJ output must be CPU RGB FP32")
        if (resized_result[1], resized_result[2]) != (geometry.output_width, geometry.output_height):
            raise RuntimeError("KJ returned inconsistent output dimensions")
        _validate_images(resized, "KJ output", chunk_frames, throw_exception_if_processing_interrupted)
        output[start:end].copy_(resized)
        del resized, resized_result
        for index in range(start, end):
            throw_exception_if_processing_interrupted()
            if compose_frame is not None:
                compose_frame(output[index], index)
    throw_exception_if_processing_interrupted()
    return output, {
        "schema": "wao_h3_ref_delivery_resize/v1", "frame_count": count,
        "source_width": width, "source_height": height,
        "requested_width": target_width, "requested_height": target_height,
        "output_width": geometry.output_width, "output_height": geometry.output_height,
        "source_crop_xywh": geometry.source_crop_xywh, "crop_position": "center", "divisible_by": 32,
        "upscale_entry": "ImageResizeKJv2.resize", "upscale_method": "nvidia_rtx_vsr",
        "chunk_frames": chunk_frames, "full_video_output_buffers": 1, "full_video_masks": 0,
        "source_frames_modified": False, "audio_modified": False,
    }


class WaoH3RefFaceDeliveryV1:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "source_frames": ("IMAGE",),
            "refined_crops": ("IMAGE",),
            "face_plan": ("H3_T8_FACE_REFINE_PARITY_PLAN",),
            "target_width": ("INT", {"default": 1088, "min": 32, "max": 16384}),
            "target_height": ("INT", {"default": 1920, "min": 32, "max": 16384}),
            "chunk_frames": ("INT", {"default": 4, "min": 1, "max": 32}),
            "paste_region": (["face_only", "face_ellipse"], {"default": "face_only"}),
            "mask_dilation": ("INT", {"default": 24, "min": 0, "max": 256}),
            "feather_source_px": ("FLOAT", {"default": 24.0, "min": 0.0, "max": 256.0}),
            "colour_match": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0}),
            "blend": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0}),
        }, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("delivery_frames", "report_json")
    FUNCTION = "deliver"
    CATEGORY = "Wao/H3/Experimental"
    DESCRIPTION = "Source-bound single-track T8 refinement projected after chunked KJ RTX VSR."

    @torch.inference_mode()
    def deliver(self, source_frames: torch.Tensor, refined_crops: torch.Tensor, face_plan: object,
                target_width: int, target_height: int, chunk_frames: int = 4,
                paste_region: str = "face_only", mask_dilation: int = 24,
                feather_source_px: float = 24.0, colour_match: float = 1.0,
                blend: float = 1.0, unique_id: str | None = None) -> tuple[torch.Tensor, str]:
        from comfy.model_management import throw_exception_if_processing_interrupted

        throw_exception_if_processing_interrupted()
        chunk_frames = _integer(chunk_frames, "chunk_frames", 1)
        if chunk_frames > 32:
            raise ValueError("chunk_frames must be <= 32")
        mask_dilation = _integer(mask_dilation, "mask_dilation")
        if mask_dilation > 256 or paste_region not in ("face_only", "face_ellipse"):
            raise ValueError("Unsupported mask dilation or paste region")
        feather_source_px = _number(feather_source_px, "feather_source_px", 0, 256)
        colour_match = _number(colour_match, "colour_match", 0, 1)
        blend = _number(blend, "blend", 0, 1)
        count, height, width = _validate_images(source_frames, "source_frames", chunk_frames,
                                               throw_exception_if_processing_interrupted)
        crop_count, crop_height, crop_width = _validate_images(refined_crops, "refined_crops", chunk_frames,
                                                             throw_exception_if_processing_interrupted)
        throw_exception_if_processing_interrupted()
        geometry = center_crop_geometry(width, height, target_width, target_height)
        dependencies = resolve_dependencies()
        parity = dependencies.parity
        parity._validate_parity_plan(face_plan)
        plan = _mapping(face_plan, "face_plan")
        source = _mapping(plan.get("source"), "source")
        if (count, height, width) != (_integer(source.get("frame_count"), "source.frame_count", 1),
                                     _integer(source.get("height"), "source.height", 2),
                                     _integer(source.get("width"), "source.width", 2)):
            raise ValueError("source_frames dimensions do not match the original T8 plan")
        if abs(_number(source.get("fps"), "source.fps", 0.01, 240) - 24) > 0.01:
            raise ValueError("T8 parity delivery requires 24fps source plan")
        aligned = _integer(source.get("h3_aligned_frame_count"), "h3_aligned_frame_count", 5)
        tail = _integer(source.get("h3_alignment_tail_frames"), "h3_alignment_tail_frames")
        if aligned != parity.align_frame_count(count) or aligned != count + tail or tail not in (0, 1):
            raise ValueError("Plan must declare exact H3 17n+5 alignment with at most one tail frame")
        canvas = _mapping(plan.get("canvas"), "canvas")
        canvas_size = _integer(canvas.get("width"), "canvas.width", 32)
        if canvas.get("height") != canvas_size or canvas_size % 32 or (crop_width, crop_height) != (canvas_size, canvas_size):
            raise ValueError("refined_crops must match the square T8 canvas exactly")
        if crop_count != aligned:
            raise ValueError("refined_crops must carry the exact declared H3 frame count; no implicit trim or pad")
        shots = plan.get("shots")
        if not isinstance(shots, list) or len(shots) != 1:
            raise ValueError("Experimental delivery requires a single-shot T8 plan")
        shot = _mapping(shots[0], "shot")
        if (shot.get("shot_id"), shot.get("start_frame"), shot.get("end_frame")) != (0, 0, count - 1):
            raise ValueError("Single shot must own every source frame")
        metrics = _mapping(plan.get("metrics"), "metrics")
        if _integer(metrics.get("multi_face_frames"), "metrics.multi_face_frames") != 0:
            raise ValueError("Multi-face plans are outside this experimental single-track contract")
        records_value = plan.get("frames")
        if not isinstance(records_value, list) or len(records_value) != count:
            raise ValueError("Plan frame records do not match source frames")
        records: list[dict[str, object]] = []
        boxes: list[tuple[float, float, float, float]] = []
        weights: list[float] = []
        detected_count = 0
        for index, value in enumerate(records_value):
            record = _mapping(value, f"frames[{index}]")
            if record.get("frame_index") != index or record.get("shot_id") != 0 or type(record.get("detected")) is not bool:
                raise ValueError("Plan records must retain explicit sequential frame and shot ownership")
            detected_count += int(record["detected"])
            boxes.append(_box(record.get("source_crop_box_xyxy"), "source_crop_box_xyxy", width, height))
            # T8 deliberately allows the centered face rectangle outside its
            # canvas; the existing mask helper owns clipping that rectangle.
            _box(record.get("crop_face_box_xyxy"), "crop_face_box_xyxy", canvas_size, canvas_size, bounded=False)
            weights.append(_number(record.get("paste_weight"), "paste_weight", 0, 1))
            records.append(record)
        if not detected_count or not any(weight > 0 for weight in weights):
            raise ValueError("Experimental delivery requires at least one usable detected face")
        if parity.source_proxy_sha256(source_frames) != source.get("proxy_sha256"):
            raise ValueError("source_frames content fingerprint does not match the original T8 plan")
        throw_exception_if_processing_interrupted()

        # Preserve T8's source-resolution midpoint feather grouping, independently
        # of the VSR memory chunk size. No full-video alpha/mask is constructed.
        upstream_chunk = max(1, min(32, int(1024 / (height * width * 3 * 4 / 2**20))))
        feathers: list[int] = []
        for start in range(0, count, upstream_chunk):
            end = min(count, start + upstream_chunk)
            midpoint_box = boxes[(start + end - 1) // 2]
            feather = max(1, min(canvas_size // 3, round(feather_source_px * canvas_size /
                                                        max(1.0, midpoint_box[3] - midpoint_box[1]))))
            feathers.extend([feather] * (end - start))

        changed_frame_count = 0

        def compose_frame(base: torch.Tensor, index: int) -> None:
            nonlocal changed_frame_count
            changed_frame_count += int(blend_delivery_frame(
                base, refined_crops[index], records[index], geometry, canvas_size,
                feathers[index], paste_region, mask_dilation, feather_source_px, colour_match,
                blend, weights[index], parity))

        output, resize_report = resize_delivery_frames(source_frames, target_width, target_height,
                                                       chunk_frames, compose_frame, unique_id)

        report = {
            **resize_report,
            "schema": "wao_h3_ref_face_delivery/v1", "status": "experimental_requires_review",
            "plan_sha256": plan["plan_sha256"], "source_proxy_sha256": source["proxy_sha256"],
            "h3_aligned_frame_count": aligned, "alignment_tail_discarded_frames": tail,
            "paste_region": paste_region, "mask_dilation": mask_dilation,
            "feather_source_px": feather_source_px, "feather_canvas_policy": "t8_source_chunk_midpoint",
            "t8_source_chunk_frames": upstream_chunk, "colour_match": colour_match,
            "colour_match_space": "post_warp_delivery_coordinates", "blend": blend,
            "undetected_frames": "t8_plan_paste_weight", "changed_frame_count": changed_frame_count,
            "outside_alpha_policy": "assign_only_positive_alpha", "source_frames_modified": False,
            "audio_modified": False, "identity_verified": False, "automatic_accept": False,
            "scope": "single_shot_single_selected_track_no_multi_face_frames",
        }
        return output, json.dumps(report, sort_keys=True, separators=(",", ":"), allow_nan=False)
