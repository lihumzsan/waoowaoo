# H3 Ref Face Delivery V1 (experimental)

ComfyUI custom node `WaoH3RefFaceDeliveryV1` replaces the final KJ resize stage
for the explicit single-shot, selected-face Ref experiment. It consumes the
original Ref second-decode frames, the existing T8 parity plan, and its decoded
refined crop batch. Audio remains on the existing independent graph edge.

The delivery node does not detect, track, crop for sampling, sample, encode, or edit a
plan. T8 remains the plan and sampling authority. This is not complete automatic
multi-person support: multi-shot plans, plans reporting multiple faces, and plans
with no usable detection are rejected. T8 tracking does not establish identity.

The package also registers `WaoH3RefAutoFaceRefineV1`, whose graph expansion is
implemented in `auto_refine.py`. It uses the installed T8 complete observation
and observed-plan entries to choose between complete no-face evidence and the
explicit single-track refinement path. It rejects unknown/incomplete detector
observations, multiple faces, scene cuts, and unverified reacquisition. A runtime
contract input exposes missing nodes, options or dependency interfaces before
execution. The existing T8 conditioning, locked source audio, crop latent,
per-frame denoise, sampler, and decoder remain the execution authorities.

The auto node's no-face route and the face delivery use the same
`resize_delivery_frames` helper: one final output buffer, small calls to the
formal KJ resize entry, and Comfy interruption checks between chunks and frames.
Only the face route supplies a per-frame composition callback. Full live
dependency loading and the automatic graph remain real-runtime acceptance work.

## Installation and application wiring

This is an experimental branch, with automatic refinement for Ref inputs and no
new UI toggle. The application's node 55 is the automatic adapter. It receives
node 20's second-pass decoded video and source audio, the raw model from node 4,
the original encoding/decoding VAEs, the existing prompt, seed and every ordered
reference. Output 168 still consumes images from node 55
and audio directly from node 20. No provider, Task, submission or terminal writer
is added. The old standalone node-55 resize is replaced by the shared KJ entry
inside this package.

Install the folder `h3_ref_face_delivery` into the **ComfyUI machine's**
`custom_nodes`, then restart that ComfyUI normally. The folder must contain
`__init__.py`, `auto_refine.py`, `nodes.py`, `dependencies.py`, `geometry.py` and
`pixels.py`. Existing ComfyUI/T8 dependencies supply torch and numpy. No model
download, database migration or security-setting change is part of installation.

Before switching the application and Windows Worker to this graph, drain all
in-progress H3 requests and check that ComfyUI's running and pending queues are
empty. This changes the graph used for Ref requests; it is not a hot-upgrade
compatibility layer for old frozen attempts. After the runtime restart, read
`/object_info/WaoH3RefAutoFaceRefineV1`: its `runtime_contract` options must contain
`h3-ref-face-auto/v1`. A value beginning `unavailable:` describes the missing
dependency. The existing application preflight rejects it before media upload.

Single-person, single-shot clips are the explicit first-stage scope. Complete
empty detector observations skip the face sampler and retain normal delivery;
detector errors, multiple faces, scene cuts and unverified identity reacquisition
fail explicitly. These limits require further implementation and evidence before
this can serve as general automatic restoration for every Ref scene.

## Visual experiment status

Four 107-frame, 24fps trials were run on the existing ComfyUI runtime: a source
face averaging about 126 pixels with a 512 canvas, and a source face averaging
about 29 pixels with 512 and 768 canvases, plus a 768-canvas trial with a dedicated
close-up restoration prompt. The input was a previously encoded Ref
output artificially downsampled for controlled review, not the original node-20
buffer or a new full Ref generation. Each trial used the same source, plan and
single crop-sampling result for its placement comparison.

The runtime produced source-stitch-then-VSR, untouched VSR base and refined crops;
lossless 8-bit FFV1 exports were used by the exact production per-frame compositor
for VSR-then-stitch review. This quantizes the original floating-point outputs.
It does not test installation, registry loading, expansion or chunked RTX VSR
inside the new package.

Visual inspection did **not** show a convincing sharpness gain from the proposed
final-resolution placement. Results remain soft with both canvases and the
close-up prompt. Do not infer
quality or identity preservation from passing geometry checks, detector coverage,
or a larger canvas. This branch is a prototype for further face-specific
conditioning and sampling evaluation, not an accepted small-face quality fix.
Real user clips, temporal identity, longer memory peaks and live integration
remain unverified. No automated quality approval is supplied.

## Supported dependency contract

The implementation was inspected against the actual installed versions:

* [T8 `b6be56527a016f2b9a999432bb30acfa68307e7c`](https://github.com/T8mars/comfyui-minimax-h3-audio-T8/blob/b6be56527a016f2b9a999432bb30acfa68307e7c/h3_t8/face_refine_parity_advanced.py)
* [KJNodes `d7641533d6634eb05f8570c980fce8fc8528dc7b`](https://github.com/kijai/ComfyUI-KJNodes/blob/d7641533d6634eb05f8570c980fce8fc8528dc7b/nodes/image_nodes.py)

Both must already be loaded in ComfyUI's `nodes.NODE_CLASS_MAPPINGS` under their
standard IDs. KJ is invoked through `ImageResizeKJv2.resize`, with explicit
`nvidia_rtx_vsr`, `crop`, `center`, `divisible_by=32`, `device=cpu`, `mask=None`,
and `per_batch=0`. KJ still uses CUDA for RTX VSR internally. There is no CPU VSR
fallback. A missing node, unknown T8 schema/module, or changed required function
signature fails explicitly. Version metadata is not inferred from a filename;
the supported versions are documented here and runtime interfaces are checked.

The T8 class must come from `h3_t8.nodes_face_refine_parity_advanced` under its
loaded custom-node package. The sibling module `face_refine_parity_advanced`
supplies these exact existing functions, checked before processing:
`_validate_parity_plan(plan)`, `source_proxy_sha256(frames)`,
`align_frame_count(frame_count)`,
`_parity_canvas_mask(record, canvas, paste_region, mask_dilation,
feather_source_px, device, feather_canvas_override)`,
`_warp_crop_to_source(crop, alpha, crop_box, output_height, output_width)`, and
`_source_space_colour_match(refined, original, alpha, strength)`.
No arbitrary module/global scan or copied tracker is used.

## Data and geometry

Inputs are CPU FP32 RGB tensors. The original source must exactly match the
plan's frame count, width, height, and T8 source proxy fingerprint. The original
signed `h3_t8_face_refine_parity_plan/v1` is validated without mutation. H3 alignment
must be exactly the declared `17n+5` grid; only a declared zero- or one-frame tail
is accepted. Refined crops must contain the declared aligned count and exact
square canvas. Only that explicitly declared tail is omitted from output.

KJ first floors requested width/height to multiples of 32, computes the source
integer crop with Python `round`, and places a center crop using integer floor
division. A source crop boundary `(x,y)` projects as
`((x-crop_x)*output_width/crop_width, (y-crop_y)*output_height/crop_height)`.
Mapping therefore includes the actual integer crop and its offset, rather than
the whole-source width/height ratios. For `448x736 -> 1088x1920`, KJ uses source
crop `(15,0,417,736)`; its odd remainder is intentional.

T8's canvas mask and Gaussian feather remain in the original plan's coordinate
system. The source-resolution chunk-midpoint feather grouping is retained and
does not vary with this node's memory chunk size. The crop-to-source and
source-to-delivery transforms are composed before the existing T8 warp, so
refined pixels never pass through the low-resolution source raster.

The original T8 stitch cannot be called for delivery: it validates the original
source dimensions/fingerprint and returns complete candidate and two mask
batches. This node reuses its mask/warp/color helpers directly. Color matching
uses the same T8 mathematics against the VSR base **in delivery coordinates**;
the report labels this semantic explicitly. It is not a claim of source-space
color-statistic equivalence. Missing/interpolated frames use the existing T8
`paste_weight`; there is no new tracking/recovery policy or heuristic fallback.

## Memory and output

One final CPU FP32 output tensor is allocated. Each small source chunk is resized
by KJ, copied into its output slice, and released before per-frame projection and
composition. Only positive-alpha output pixels are assigned; all other VSR pixel
bits remain untouched. Input tensors are never written. No full-video masks,
full-video delivery clone, or list of all resized chunks is created.

`nodes.resize_delivery_frames(source_frames, target_width, target_height,
chunk_frames=4, compose_frame=None, unique_id=None)` is the sole KJ chunk loop
for both automatic routes. It returns `(frames, resize_report)`; an optional
callback receives only the current owned output frame and its source index.

The full final tensor remains necessary for ComfyUI IMAGE output. At 736 frames
and `1088x1920` RGB FP32 it alone occupies about 17.18 GiB, in addition to source,
crop, model, KJ chunk, and per-frame working storage. KJ opens its VSR context on
each resize invocation; runtime, GPU peak memory, and chunk-boundary quality need
real-machine review. This package does not implement a separate VSR engine.

Outputs are one IMAGE and a bounded JSON STRING containing aggregate counts,
dimensions, source/plan identities, geometry, memory policy, and explicit review
limits. It does not return audio, full-frame masks, or unbounded per-frame lists.
ComfyUI's existing interruption check runs between chunks and frames; an abort
raises through the graph and does not return a partially populated output.

`nodes.blend_delivery_frame` is the same per-frame mathematical core used by the
node. An offline review can supply a fresh VSR frame, its refined crop, original
record, exact `CropGeometry`, explicit composition parameters, and actual T8 math
module. The caller remains responsible for original source/plan binding. Such a
review does not establish that a real ComfyUI registry or RTX VSR call succeeded.

## Reference alignment

| T8/KJ touchpoint | Delivery coverage / non-applicability | Verification |
|---|---|---|
| Automatic observation | Official full-source observation and verification; unknown fails; only complete empty detection skips sampling | Source contract inspection and admitted protocol cases; live adapter execution still required |
| Reference identity | Every original image/audio ordinal retained; no cast or character identity inferred | App source review, explicit-slot protocol cases |
| Plan identity and source scope | Original plan hash and source proxy checked with T8; plan never rewritten | Runtime required checks; real T8 execution still required |
| Frame/canvas contract | Exact count, RGB FP32, source dimensions, square canvas, explicit H3 tail | Runtime required checks |
| Tracking and sampling | Existing T8 plan/crop/latent/denoise/sampler retained upstream | Not reimplemented here |
| Resize execution | Loaded KJ registry entry, exact center integer crop and dimensions | Independent affine oracle; actual RTX VSR still required |
| Mask and feather | Existing T8 helper, original source midpoint grouping | Fixed upstream contract inspection; real tensor execution still required |
| Projection | Existing T8 bilinear warp with composed crop geometry | Independent edge/half-pixel affine oracle |
| Color | Existing T8 weighted moment helper, explicitly delivery-space | Source inspection; real visual comparison still required |
| Pixel ownership | One output writer; assign only positive alpha | Independent real NumPy bit-preservation oracle |
| Failure/recovery | Dependency, plan, shape, nonfinite and unsupported scope errors abort; retry belongs to Comfy execution | No second state machine |
| Persistence and permissions | Not applicable: pure in-memory node, no disk/network/data writes | Code inspection |
| Audio | Not applicable: no audio input/output or tensor access | Node schema and code inspection |
| App execution and final handoff | Existing profile/preflight/submission/Task/output-168 path; one final writer; no new persistent fact or retry owner | Type checks and existing profile conformance; new full Ref request still required |
| Projection/UI/i18n | Standard Comfy node schema and machine-readable JSON; no application UI introduced | App integration owned by caller |

## Local verification

Run the admitted nontrivial pure-math/pixel tests without importing torch or
mocking ComfyUI:

```powershell
python -m unittest discover -s runtime/comfyui/h3_ref_face_delivery -p 'test_*.py' -v
python -m compileall -q runtime/comfyui/h3_ref_face_delivery
python runtime/comfyui/h3_ref_face_delivery/verify_torch_math.py
```

The delivery math tests use independent hand-derived integer crop/affine
coordinates and the algebraic alpha
composition/pixel-preservation law. They reject wrong full-frame ratios,
half-pixel errors, zero-sized rounded targets, mutations outside alpha support,
and partial writes from nonfinite patches. They do not claim GPU/model quality,
full-video memory measurements, or live ComfyUI dependency loading coverage.

The separate real CPU torch check passed three additional mathematical cases:
hand-derived refined pixel-center sampling through the complete frame core,
weighted color moments, and bit-exact signed-zero preservation outside the real
T8 mask. It executes the four unmodified mathematical function definitions from
the installed T8 SHA, loaded from source into a module with real torch. This is
not a mock node or a substitute production dependency. It downloads the pinned
sources into memory by default; use `--parity-source` and `--advanced-source` to
read the corresponding installed files instead. The core also verifies source
and refined crop tensors remain unchanged. torch must be installed; missing
dependencies or sources fail explicitly.

The combined local discovery run also passed the auto adapter's eleven pure
observation/reference/plan admission cases (17 total with the six delivery
cases). Those checks do not execute detection, conditioning or sampling, and
cannot establish generated media quality or the live graph expansion contract.

Application checks run for this branch:

```text
npm run typecheck
npx eslint src/lib/ai-providers/comfyui/profiles.ts src/lib/ai-providers/comfyui/h3.ts tests/contracts/comfyui-h3-profile-conformance.test.ts
npx vitest run tests/contracts/comfyui-h3-profile-conformance.test.ts --exclude '**/.worktrees/**' --reporter=dot
git diff --check
```

All passed; the scoped profile run passed 23 cases. An initial unscoped Vitest
command also collected unrelated `.worktrees` copies and failed; the scoped run
above is the applicable result. One obsolete assertion counting a standalone
RTX resize node was removed because that graph edge is now encapsulated by the
automatic adapter. No production fallback was introduced to preserve it.
