"""Explicit experimental H3 Ref auto routing; the registered nodes own sampling.

The complete detector observation owns no-face evidence. This adapter admits
only one shot and at most one face per frame; it does not infer character IDs.
"""

from __future__ import annotations

import inspect
import json
import math


RUNTIME_CONTRACT = "h3-ref-face-auto/v1"
DETECTOR_MODEL = "ultralytics/bbox/face_yolov8m.pt"
REFINE_LORA = "h3\\minimax_h3_fl2v_turbo_4step_v0.1_comfyui_alpha8-T8-convert.safetensors"
REQUIRED_NODES = (
    "MiniMaxH3CompleteFaceObserveEXPT8", "MiniMaxH3ObservedParityPlanEXPT8",
    "MiniMaxH3AudioConditioningT8", "MiniMaxH3FaceRefineParityLatentT8Advanced",
    "MiniMaxH3FaceRefinePerFrameDenoiseT8Advanced", "MiniMaxH3SigmaShift",
    "LoraLoaderModelOnly", "RandomNoise", "BasicGuider", "KSamplerSelect",
    "BasicScheduler", "SamplerCustomAdvanced", "MiniMaxH3AVDecodeT8",
    "ImageResizeKJv2", "WaoH3RefFaceDeliveryV1",
)


def _fail(reason: str, **details: object):
    raise ValueError("WAO_H3_AUTO_FACE_REJECTED:" + json.dumps({
        "schema": RUNTIME_CONTRACT, "reason": reason,
        "scope": "experimental_single_shot_single_track", **details,
    }, sort_keys=True, separators=(",", ":"), allow_nan=False))


def _mapping(value: object, label: str) -> dict:
    if type(value) is not dict:
        _fail("invalid_" + label)
    return value


def _geometry(observation: dict) -> tuple[int, int, int]:
    binding = _mapping(observation.get("binding"), "observation_binding")
    shape = binding.get("geometry")
    if type(shape) is not list or len(shape) != 3 or any(type(v) is not int or v < 1 for v in shape):
        _fail("invalid_observation_geometry")
    return tuple(shape)


def classify_observation(observation: object) -> str:
    """Admission after the official FaceObservation.verify(), never from text."""
    observation = _mapping(observation, "observation")
    status = observation.get("status")
    if status not in ("face_found", "no_face_detected"):
        _fail("detector_unknown", detector_failure=observation.get("failure", "unknown status"))
    count, height, width = _geometry(observation)
    detections = observation.get("detections")
    if (type(detections) is not list or len(detections) != count
            or type(observation.get("observed_frames")) is not int or observation["observed_frames"] != count):
        _fail("incomplete_detector_coverage")
    found = False
    for index, items in enumerate(detections):
        if type(items) is not list:
            _fail("incomplete_frame_observation", frame=index)
        if len(items) > 1:
            _fail("multi_face_not_supported", frame=index, face_count=len(items))
        for item in items:
            item = _mapping(item, "detection")
            box, confidence = item.get("box"), item.get("confidence")
            if (type(box) is not list or len(box) != 4
                    or any(type(v) not in (int, float) or not math.isfinite(v) for v in box)
                    or not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height)
                    or type(confidence) not in (int, float) or not math.isfinite(confidence)
                    or not 0 <= confidence <= 1):
                _fail("invalid_detector_geometry", frame=index)
        found = found or bool(items)
    if (status == "face_found") != found:
        _fail("observation_status_contradiction")
    return "single_track" if found else "no_face"


def validate_single_track_plan(plan: object, observation: dict) -> None:
    plan = _mapping(plan, "plan")
    count, height, width = _geometry(observation)
    source = _mapping(plan.get("source"), "plan_source")
    if (source.get("frame_count"), source.get("height"), source.get("width"), source.get("fps")) != (count, height, width, 24):
        _fail("plan_source_geometry_mismatch")
    shots = plan.get("shots")
    if type(shots) is not list or len(shots) != 1:
        _fail("multi_shot_not_supported")
    shot = _mapping(shots[0], "shot")
    if (shot.get("shot_id"), shot.get("start_frame"), shot.get("end_frame")) != (0, 0, count - 1):
        _fail("incomplete_shot_interval")
    metrics = _mapping(plan.get("metrics"), "plan_metrics")
    if metrics.get("multi_face_frames") != 0:
        _fail("multi_face_plan_not_supported")
    records = plan.get("frames")
    if type(records) is not list or len(records) != count:
        _fail("incomplete_plan_records")
    allowed = {"detected", "reacquired", "interpolated", "occluded", "lost"}
    last_detection = None
    for index, record in enumerate(records):
        record = _mapping(record, "plan_frame")
        state = record.get("state")
        if state == "reacquired_unverified":
            _fail("unverified_reacquisition_not_supported", frame=index)
        if (record.get("frame_index"), record.get("shot_id")) != (index, 0) or state not in allowed:
            _fail("invalid_plan_frame_state", frame=index)
        weight = record.get("paste_weight")
        if type(weight) not in (int, float) or not math.isfinite(weight) or not 0 <= weight <= 1:
            _fail("invalid_paste_weight", frame=index)
        if state == "lost" and weight != 0:
            _fail("lost_frame_must_not_be_patched", frame=index)
        if state in ("detected", "reacquired"):
            if last_detection is not None and index - last_detection - 1 > 4:
                _fail("unverified_long_gap_reacquisition", frame=index)
            last_detection = index


def conditioning_references(references: dict[str, object]) -> dict[str, object]:
    allowed = {f"ref_image_{index}" for index in range(9)} | {f"ref_audio_{index}" for index in range(3)}
    if set(references) - allowed:
        _fail("unknown_reference_slot")
    result = {}
    for kind, limit in (("image", 9), ("audio", 3)):
        present = [index for index in range(limit) if f"ref_{kind}_{index}" in references]
        if present != list(range(len(present))) or (kind == "image" and not present):
            _fail("reference_ordinals_must_be_contiguous", channel=kind)
        for index in present:
            value = references[f"ref_{kind}_{index}"]
            if value is None:
                _fail("empty_reference_slot", channel=kind, ordinal=index)
            result[f"ref_{kind}s.ref_{kind}_{index}"] = value
    return result


def _options(schema: dict, input_name: str) -> tuple[str, ...]:
    for location in ("required", "optional"):
        definition = schema.get(location, {}).get(input_name)
        if not isinstance(definition, (list, tuple)) or not definition:
            continue
        if isinstance(definition[0], (list, tuple)):
            return tuple(definition[0])
        if definition[0] == "COMBO" and len(definition) > 1:
            return tuple(definition[1].get("options", ()))
    return ()


def _registered_runtime():
    import nodes
    from comfy.model_management import throw_exception_if_processing_interrupted
    from comfy_execution.graph_utils import GraphBuilder

    if not callable(throw_exception_if_processing_interrupted):
        raise RuntimeError("missing_comfy_interruption_entry")

    registry = nodes.NODE_CLASS_MAPPINGS
    for name in REQUIRED_NODES:
        if name not in registry:
            raise RuntimeError("node_missing:" + name)
    for name, parameters in (
        ("MiniMaxH3CompleteFaceObserveEXPT8", ("source_images", "request")),
        ("MiniMaxH3ObservedParityPlanEXPT8", ("observation", "options")),
    ):
        entry = registry[name]
        if entry.__module__.split(".")[-2:] != ["h3_t8", "nodes_face_observations"]:
            raise RuntimeError("unsupported_official_module:" + name)
        signature = inspect.signature(entry.execute)
        if (tuple(signature.parameters) != parameters
                or signature.parameters[parameters[-1]].kind is not inspect.Parameter.VAR_KEYWORD):
            raise RuntimeError("unsupported_official_signature:" + name)
    required_fields = {
        "MiniMaxH3AudioConditioningT8": {"clip", "video_vae", "audio_vae", "prompt", "width", "height", "length",
            "task_type", "audio_mode", "audio_denoise_strength", "add_source_as_reference", "prompt_primary_audio_ordinal",
            "strict_prompt_tags", "ref_image_size", "reference_video_policy", "allow_above_reference_area", "drive_audio",
            "ref_images", "ref_audios"},
        "MiniMaxH3FaceRefineParityLatentT8Advanced": {"positive", "av_latent", "crops", "video_vae", "face_plan",
            "audio_policy", "allow_multi_shot_exp"},
        "MiniMaxH3FaceRefinePerFrameDenoiseT8Advanced": {"av_latent", "face_plan", "strength_small_face", "strength_large_face",
            "scale_mode", "face_px_small", "face_px_large", "gamma", "smooth_frames", "video_mask_mode", "require_locked_audio"},
        "MiniMaxH3SigmaShift": {"model", "shift_video", "shift_audio"},
        "LoraLoaderModelOnly": {"model", "lora_name", "strength_model"},
        "RandomNoise": {"noise_seed"}, "BasicGuider": {"model", "conditioning"},
        "KSamplerSelect": {"sampler_name"}, "BasicScheduler": {"model", "scheduler", "steps", "denoise"},
        "SamplerCustomAdvanced": {"noise", "guider", "sampler", "sigmas", "latent_image"},
        "MiniMaxH3AVDecodeT8": {"av_latent", "video_vae", "audio_vae"},
        "ImageResizeKJv2": {"image", "width", "height", "upscale_method", "keep_proportion", "divisible_by",
            "pad_color", "crop_position", "device"},
        "WaoH3RefFaceDeliveryV1": {"source_frames", "refined_crops", "face_plan", "target_width", "target_height",
            "chunk_frames", "paste_region", "mask_dilation", "feather_source_px", "colour_match", "blend"},
    }
    for name, expected in required_fields.items():
        schema = registry[name].INPUT_TYPES()
        actual = set(schema.get("required", {})) | set(schema.get("optional", {}))
        missing = expected - actual
        if missing:
            raise RuntimeError("inputs_missing:" + name + ":" + ",".join(sorted(missing)))
    checks = (
        ("MiniMaxH3CompleteFaceObserveEXPT8", "route", "parity"),
        ("MiniMaxH3CompleteFaceObserveEXPT8", "detector_model", DETECTOR_MODEL),
        ("MiniMaxH3CompleteFaceObserveEXPT8", "detector_mode", "local_ultralytics"),
        ("MiniMaxH3CompleteFaceObserveEXPT8", "detector_device", "cpu"),
        ("MiniMaxH3ObservedParityPlanEXPT8", "canvas_mode", "manual_512"),
        ("MiniMaxH3AudioConditioningT8", "task_type", "Ref2VA"),
        ("MiniMaxH3AudioConditioningT8", "audio_mode", "lock_source"),
        ("MiniMaxH3AudioConditioningT8", "ref_image_size", "match"),
        ("MiniMaxH3AudioConditioningT8", "reference_video_policy", "official_2_to_15s"),
        ("MiniMaxH3FaceRefineParityLatentT8Advanced", "audio_policy", "require_locked"),
        ("MiniMaxH3FaceRefinePerFrameDenoiseT8Advanced", "scale_mode", "relative_to_clip"),
        ("MiniMaxH3FaceRefinePerFrameDenoiseT8Advanced", "video_mask_mode", "replace_video_parity"),
        ("LoraLoaderModelOnly", "lora_name", REFINE_LORA),
        ("KSamplerSelect", "sampler_name", "er_sde"),
        ("BasicScheduler", "scheduler", "simple"),
        ("ImageResizeKJv2", "upscale_method", "nvidia_rtx_vsr"),
        ("ImageResizeKJv2", "keep_proportion", "crop"),
        ("ImageResizeKJv2", "crop_position", "center"),
        ("ImageResizeKJv2", "device", "cpu"),
        ("WaoH3RefFaceDeliveryV1", "paste_region", "face_only"),
    )
    for name, input_name, value in checks:
        if value not in _options(registry[name].INPUT_TYPES(), input_name):
            raise RuntimeError("option_missing:" + name + ":" + input_name + ":" + value)
    # Bind the delivery's existing exact helper/resize ABI before any uploads.
    from .dependencies import resolve_dependencies
    from .nodes import resize_delivery_frames
    resolve_dependencies()
    if tuple(inspect.signature(resize_delivery_frames).parameters) != (
            "source_frames", "target_width", "target_height", "chunk_frames", "compose_frame", "unique_id"):
        raise RuntimeError("unsupported_resize_delivery_helper_signature")
    return registry, GraphBuilder


def runtime_contract_options() -> list[str]:
    try:
        _registered_runtime()
        return [RUNTIME_CONTRACT]
    except Exception as error:
        return ["unavailable:" + type(error).__name__ + ":" + str(error)[:512]]


def _node_outputs(result: object, length: int, name: str) -> tuple:
    values = getattr(result, "result", None)
    if type(values) is not tuple or len(values) != length:
        raise RuntimeError("Unsupported registered NodeOutput contract:" + name)
    return values


class WaoH3RefAutoFaceRefineV1:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "runtime_contract": (runtime_contract_options(),),
            "source_frames": ("IMAGE",), "source_audio": ("AUDIO",),
            "raw_model": ("MODEL",), "clip": ("CLIP",),
            "video_vae": ("VAE",), "audio_vae": ("VAE",),
            "prompt": ("STRING", {"forceInput": True}),
            "width": ("INT", {"default": 1088, "min": 32, "max": 16384}),
            "height": ("INT", {"default": 1920, "min": 32, "max": 16384}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
        }, "optional": {
            **{f"ref_image_{index}": ("IMAGE",) for index in range(9)},
            **{f"ref_audio_{index}": ("AUDIO",) for index in range(3)},
        }, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("delivery_frames", "report_json")
    FUNCTION = "refine"
    CATEGORY = "Wao/H3/Experimental"
    DESCRIPTION = "Automatic complete-observation routing; rejects multiple faces, scene cuts and unverified reacquisition."

    @classmethod
    def IS_CHANGED(cls, **_inputs):
        return float("nan")

    def refine(self, runtime_contract, source_frames, source_audio, raw_model, clip,
               video_vae, audio_vae, prompt, width, height, seed,
               unique_id=None, **references):
        target_width, target_height = width, height
        if runtime_contract != RUNTIME_CONTRACT:
            _fail("runtime_contract_mismatch")
        registry, graph_builder = _registered_runtime()
        if (type(target_width) is not int or type(target_height) is not int
                or min(target_width, target_height) < 32 or max(target_width, target_height) > 16384
                or type(seed) is not int or not 0 <= seed <= 0xFFFFFFFFFFFFFFFF
                or type(prompt) is not str or not prompt.strip()):
            _fail("invalid_execution_parameters")
        reference_inputs = conditioning_references(references)
        from comfy.model_management import throw_exception_if_processing_interrupted
        throw_exception_if_processing_interrupted()
        observed = _node_outputs(registry["MiniMaxH3CompleteFaceObserveEXPT8"].execute(
            source_images=source_frames, route="parity", fps=24.0, source_start_frame=0,
            detector_mode="local_ultralytics", detector_model=DETECTOR_MODEL,
            detector_device="cpu", confidence=0.35,
        ), 3, "CompleteFaceObserve")
        throw_exception_if_processing_interrupted()
        observation = observed[0]
        contract = observation.verify()
        throw_exception_if_processing_interrupted()
        route = classify_observation(contract)
        graph = graph_builder()
        report = {"schema": RUNTIME_CONTRACT, "route": route,
                  "observation_sha256": observed[2], "source": contract["binding"]["source"],
                  "automatic_accept": False, "identity_verified": False,
                  "source_audio_passthrough": True,
                  "scope": "experimental_single_shot_single_track"}
        if route == "no_face":
            from .nodes import resize_delivery_frames
            resized, resize_report = resize_delivery_frames(
                source_frames, target_width, target_height, chunk_frames=4,
                compose_frame=None, unique_id=unique_id)
            report["status"] = "complete_detector_no_face_not_applicable"
            report["resize"] = resize_report
            return {"result": (resized, json.dumps(report, sort_keys=True))}

        throw_exception_if_processing_interrupted()
        planned = _node_outputs(registry["MiniMaxH3ObservedParityPlanEXPT8"].execute(
            observation=observation, manual_roi_x=0.30, manual_roi_y=0.10,
            manual_roi_width=0.40, manual_roi_height=0.55, scene_cut_threshold=0.28,
            max_track_jump=0.18, max_gap_frames=4, center_smooth_window=21,
            size_smooth_window=51, crop_factor=2.5, canvas_mode="manual_512",
            require_h3_grid=True, analysis_chunk_frames=8,
        ), 9, "ObservedParityPlan")
        throw_exception_if_processing_interrupted()
        observation.verify()
        throw_exception_if_processing_interrupted()
        face_plan, crops = planned[0], planned[1]
        validate_single_track_plan(face_plan, contract)
        conditioning = graph.node("MiniMaxH3AudioConditioningT8", clip=clip,
            video_vae=video_vae, audio_vae=audio_vae, prompt=prompt,
            width=planned[5], height=planned[6], length=planned[7], task_type="Ref2VA",
            audio_mode="lock_source", audio_denoise_strength=0.0,
            add_source_as_reference=False, prompt_primary_audio_ordinal=0,
            strict_prompt_tags=True, ref_image_size="match", reference_video_policy="official_2_to_15s",
            allow_above_reference_area=False, drive_audio=source_audio, **reference_inputs)
        lora = graph.node("LoraLoaderModelOnly", model=raw_model, lora_name=REFINE_LORA, strength_model=0.75)
        model = graph.node("MiniMaxH3SigmaShift", model=lora.out(0), shift_video=12.0, shift_audio=3.0)
        latent = graph.node("MiniMaxH3FaceRefineParityLatentT8Advanced",
            positive=conditioning.out(0), av_latent=conditioning.out(1), crops=crops,
            video_vae=video_vae, face_plan=face_plan, audio_policy="require_locked", allow_multi_shot_exp=False)
        denoise = graph.node("MiniMaxH3FaceRefinePerFrameDenoiseT8Advanced", av_latent=latent.out(1),
            face_plan=face_plan, strength_small_face=0.8, strength_large_face=0.35,
            scale_mode="relative_to_clip", face_px_small=30.0, face_px_large=120.0,
            gamma=1.0, smooth_frames=9, video_mask_mode="replace_video_parity", require_locked_audio=True)
        guider = graph.node("BasicGuider", model=model.out(0), conditioning=latent.out(0))
        sampler = graph.node("KSamplerSelect", sampler_name="er_sde")
        schedule = graph.node("BasicScheduler", model=model.out(0), scheduler="simple", steps=8, denoise=0.45)
        noise = graph.node("RandomNoise", noise_seed=seed)
        sampled = graph.node("SamplerCustomAdvanced", noise=noise.out(0), guider=guider.out(0),
            sampler=sampler.out(0), sigmas=schedule.out(0), latent_image=denoise.out(0))
        decoded = graph.node("MiniMaxH3AVDecodeT8", av_latent=sampled.out(1), video_vae=video_vae, audio_vae=audio_vae)
        delivery = graph.node("WaoH3RefFaceDeliveryV1", source_frames=source_frames,
            refined_crops=decoded.out(0), face_plan=face_plan, target_width=target_width,
            target_height=target_height, chunk_frames=4, paste_region="face_only",
            mask_dilation=24, feather_source_px=24.0, colour_match=1.0, blend=1.0)
        report.update(status="experimental_candidate_requires_review", plan_sha256=face_plan["plan_sha256"],
                      canvas=[planned[5], planned[6]], source_audio_passthrough=True)
        return {"result": (delivery.out(0), json.dumps(report, sort_keys=True)), "expand": graph.finalize()}
