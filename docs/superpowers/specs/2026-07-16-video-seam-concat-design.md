# Video Seam Concat Design

## Goal

Add a standalone “视频无缝拼接” tool that accepts two uploaded videos, runs the supplied ComfyUI workflow, and returns a persisted downloadable MP4. The feature is independent of novel projects and is reachable from the main navigation.

## Product placement

- Add “视频工具” to the authenticated top navigation between “工作区” and “资产中心”.
- Route the link to `/workspace/video-tools`.
- Keep the feature outside the novel-promotion stage navigation because it has no project, episode, storyboard, or panel dependency.
- Use the page title “视频无缝拼接” and explain that the first frame of Video 2 is removed before the streams are joined.

## User experience

The page has three vertical zones:

1. Two equal upload cards labeled “Video 1” and “Video 2”. Each card supports drag/drop and file selection, shows an inline video preview after upload, and exposes replace/remove actions.
2. A centered primary action labeled “开始拼接”. It is enabled only when both uploads have completed and no task is active.
3. A large result area. It shows truthful stages (`上传中`, `排队中`, `正在拼接`, `已完成`, `失败`) without inventing a completion percentage. On success it provides playback, download, and a new run with the same inputs. On failure it preserves both inputs and allows retry.

The bottom of the page shows the five most recent seam-concat tasks. Refreshing or revisiting the page restores queued/running state and completed results from the shared task store.

## Workflow contract

Bundle the supplied workflow as `basevideo/tools/video-seam-concat-nvenc` in API graph format. Its fixed contract is:

- Node `1` (`LoadVideo.file`): Video 1.
- Node `2` (`LoadVideo.file`): Video 2.
- Node `3`: read Video 1 images, audio, and FPS.
- Node `4`: calculate one frame duration as `1 / fps`.
- Node `5`: remove that duration from the start of Video 2, including synchronized audio.
- Nodes `7` and `8`: append images and audio.
- Node `9` (`VHS_VideoCombine`): output H.264 MP4 through `video/nvenc_h264-mp4`, `yuv420p`, 10 Mbit/s, using Video 1 FPS, with filename prefix `shot-3-video`.

The UI exposes no workflow selector or node parameters. The server injects the two uploaded filenames into `LoadVideo` nodes in ascending node order.

## Architecture and data flow

1. `POST /api/video-tools/uploads` accepts one authenticated multipart video upload, validates its extension, MIME type, non-empty size, and a 256 MiB maximum, then stores it under a user-scoped `video-tools/<userId>/inputs/` key.
2. `POST /api/video-tools/seam-concat` accepts two user-scoped storage keys and original filenames, validates ownership, and submits a `video_seam_concat` task with sentinel project id `video-tools` to the existing video queue.
3. The video worker resolves the user’s configured ComfyUI base URL, obtains fetchable URLs for both stored inputs, uploads them to ComfyUI, injects them into the bundled workflow, submits the prompt, waits for the final video, and downloads the result.
4. The worker stores the output under `video-tools/<userId>/outputs/` and completes the task with the storage key and stable application URL.
5. The page reads recent tasks through the existing authenticated task endpoint using `projectId=video-tools` and `type=video_seam_concat`. Active state follows the existing SSE-aware task query path when available, with a bounded fallback refresh for this standalone page.

## Boundaries

- `workflow-registry.ts` owns `LoadVideo` filename injection and input counting.
- `client.ts` owns ComfyUI upload, prompt submission, output discovery, and download.
- A focused seam-concat worker handler owns payload validation, provider lookup, storage URLs, result persistence, and progress stages.
- Video-tools API routes own authentication and request validation.
- Video-tools React components own upload interaction, task presentation, and result playback.

The browser never calls ComfyUI directly and never receives its configured base URL.

## Error handling

- Reject missing, empty, unsupported, oversized, or non-user-scoped uploads with a specific 4xx error.
- Reject task submission unless both storage keys belong to the authenticated user.
- Report missing ComfyUI configuration as a user-facing configuration error.
- Preserve uploaded inputs when ComfyUI upload, queue, execution, output discovery, or result persistence fails.
- Prevent duplicate submissions while an active task exists.
- Do not claim that canceling a local task interrupts an already running ComfyUI graph; the first version does not expose a cancel button.

## Testing and verification

- Unit-test UI-to-API workflow loading, two `LoadVideo` injections, input counting, and preservation of the NVENC output graph.
- Unit-test ComfyUI media upload and seam-concat submission against mocked ComfyUI endpoints.
- Unit-test upload validation, user-scoped key validation, worker payload validation, and worker result persistence.
- Contract-test authentication and request validation for both new API routes.
- Component-test enablement, upload replacement/removal, active-task presentation, failure retry, and completed result rendering.
- Run TypeScript type checking and the targeted regression suite.
- Start the real development stack and verify the complete workflow with:
  - `C:\work\tool\蛊真人后续\video片段\shot-1-video.mp4`
  - `C:\work\tool\蛊真人后续\video片段\shot-2-video.mp4`
- Confirm the generated MP4 is playable, has the expected concatenated duration minus one Video 2 frame, and is downloadable from the UI.

## Scope exclusions

- No project or episode association.
- No arbitrary workflow picker.
- No trim controls, transition controls, encoding controls, or batch mode.
- No separate history page.
- No database migration; the existing task/result JSON fields store the tool state.
