---
name: video-editing
description: 编排已有视频、裁切片段、添加有据的角色姓名说明与文字渐入渐出，并通过 Wao 导出可编辑剪映工程。
---

# 视频编排与剪映工程

Use for editing existing ready videos, character name captions and native text fades. The authoritative output schema is injected by Wao. This Skill defines editing intent; the deterministic Wao exporter owns files and serialization.

1. Read the requested screenplay/direction and exact ready video versions through Wao tools. Inspect source descriptions, lineage and durations. If the identity, order or content is uncertain, ask for the missing fact. Never infer a character from an uninspected image, a filename, a numeric position or a recently generated video. Do not claim face recognition or automatic first appearance detection.
2. Create a distinct clipId for EVERY use of a video. clips array order is the final order; sourceStartMs and durationMs are explicit source trims at speed 1. Text layers bind to clipId and use clip-relative offsets. Repeated uses of the same source remain distinct. All intervals must fit entirely; do not silently trim or drop invalid layers. MP4 maps cumulative cut endpoints to the nearest rational output frame, so its total duration may differ from authored milliseconds by at most half a frame. A clip with no output frame is rejected before submission; never silently drop it. Native editing retains the authored millisecond intervals.
3. Name and description must come from an exact character Resource version that you read, or the user's explicit instruction. Set nameSource accordingly. Store the relevant screenplay/direction versions in contextReferences. Ambiguous names need clarification before submission.
4. Use only declared productionCapabilities.editing targets. Phase 1 supports a lower_third name/description, bottom_left or bottom_right, and native fade/none entrance and exit. No tracking, transitions, paid templates, arbitrary font/effect IDs or invented animation names. Fade durations cannot overlap. Warn about crowded compositions; do not promise visual placement without native review.
5. For Jianying choose outputTarget=jianying_project and preserve or mute source audio. Music cues, replacement tracks and mixed BGM remain MP4 capabilities. MP4 rejects text layers. Never remove requested text or change the target to get a task accepted.
6. When the user authorizes creation/export, call merge_videos once with name, optional folderPath, the exact composition and outputTarget. Do not ask them to copy Resource IDs. A successful Task returns an archive Resource, not a rendered video. Report the download and the controlled new-directory import instructions. Only save the optional video_edit JSON with save_project_document if explicitly requested.
7. Configuration requires Python and a genuine empty native draft from the user's target Jianying version. Missing configuration must be reported. Native Jianying 5.0 playback, text animation availability and final MP4 export require user verification on that machine; task success alone proves only the archive was created.
