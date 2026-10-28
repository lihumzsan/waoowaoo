"""Wao sealed serializer. No UI automation, network, probing or user-project writes."""
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "vendor"))
import pyJianYingDraft as draft
from probe_environment import probe


def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    output = Path(sys.argv[2])
    profile = request["profile"]
    if probe() != profile["environment"]:
        raise RuntimeError("Serializer environment changed since submission")
    template = output / profile["draftFileName"]
    template.write_text(json.dumps(profile["draft"], ensure_ascii=False), encoding="utf-8")
    # The sealed process owns UUID allocation; resource metadata/checksums remain untouched.
    counter = 0
    def next_identity():
        nonlocal counter
        counter += 1
        return uuid.uuid5(uuid.NAMESPACE_URL, request["identity"] + ":" + str(counter))
    uuid.uuid4 = next_identity
    script = draft.ScriptFile.load_template(str(template))
    format = request["format"]
    script.width, script.height = format["width"], format["height"]
    numerator, denominator = map(int, format["frameRate"].split("/"))
    script.fps = numerator / denominator
    script.add_track(draft.TrackType.video, "video")
    for clip, source in zip(request["timeline"]["clips"], request["sources"], strict=True):
        # Bypass upstream's probing/defaults: Wao has already measured this exact version.
        material = draft.VideoMaterial.__new__(draft.VideoMaterial)
        material.material_name = source["fileName"]
        material.material_id = uuid.uuid4().hex
        material.local_material_id = Path(source["fileName"]).stem
        material.path = "__WAO_PROJECT__/media/" + source["fileName"]
        material.crop_settings = draft.CropSettings()
        material.material_type = "video"
        material.width, material.height = source["width"], source["height"]
        material.duration = source["durationMs"] * 1000
        segment = draft.VideoSegment(
            material, draft.Timerange(clip["targetStartMs"] * 1000, clip["durationMs"] * 1000),
            source_timerange=draft.Timerange(clip["sourceStartMs"] * 1000, clip["durationMs"] * 1000),
            volume=0.0 if request["audioMode"] == "mute" else 1.0,
        )
        script.add_segment(segment, "video")
    for index, layer in enumerate(request["timeline"]["textLayers"]):
        track = "text-" + str(index)
        script.add_track(draft.TrackType.text, track)
        text = layer["name"] + (("\n" + layer["description"]) if layer["description"] else "")
        segment = draft.TextSegment(
            text, draft.Timerange(layer["targetStartMs"] * 1000, layer["durationMs"] * 1000),
            style=draft.TextStyle(size=7, bold=True, align=0 if layer["placementKey"] == "bottom_left" else 2),
            clip_settings=draft.ClipSettings(transform_x=-0.45 if layer["placementKey"] == "bottom_left" else 0.45, transform_y=-0.72),
            border=draft.TextBorder(width=12),
        )
        if layer["intro"]["kind"] == "fade":
            segment.add_animation(draft.TextIntro.渐显, duration=layer["intro"]["durationMs"] * 1000)
        if layer["outro"]["kind"] == "fade":
            segment.add_animation(draft.TextOutro.渐隐, duration=layer["outro"]["durationMs"] * 1000)
        script.add_segment(segment, track)
    content = json.loads(script.dumps())
    content["id"] = uuid.uuid5(uuid.NAMESPACE_URL, request["identity"]).hex
    content["create_time"] = content["update_time"] = 0
    template.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata = profile["metadata"].copy()
    metadata.update({
        "draft_id": content["id"], "draft_name": request["name"],
        "draft_fold_path": "__WAO_PROJECT__", "draft_root_path": "",
        "draft_cover": "", "draft_materials": [],
        "draft_timeline_materials_size_": 0,
        "tm_draft_create": 0, "tm_draft_modified": 0,
        "tm_duration": request["timeline"]["durationMs"] * 1000,
    })
    (output / "draft_meta_info.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
