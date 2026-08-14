# Timed environment-sound cues for video merge

## Goal

Allow `merge_videos` to place independently generated environment-sound Resources
on an exact final-video timeline and render one finished MP4 through the existing
FFmpeg composition path. Background music, environment sound, and dialogue/source
audio remain distinct modalities and buses.

## Non-goals

- Do not add a ComfyUI mixing workflow or a second audio provider.
- Do not reclassify environment sound as background music.
- Do not change the existing generate-sound, voiceover, ordinary `mix`, `replace`,
  `mute`, or multi-video `preserve` behavior.
- Do not add a second task type, persistence writer, or task state machine.

## Authoritative path and ownership

`merge_videos` remains the only planning entry point. It resolves exact
`resourceId + contentVersion` references, freezes cue placements in the Task
payload, reserves the output Resource in the existing transaction, and submits
the existing video-merge Task. The video-merge handler remains the sole executor;
the existing terminal materializer remains the sole writer of the output Resource,
version, lineage, and terminal Task state.

ComfyUI/MOSS remains responsible only for creating each individual sound Resource.
FFmpeg owns deterministic timeline rendering and MP4 audio muxing.

## Contract

Add `soundCues` to the public `merge_videos` request and frozen video-merge Task
payload. Each cue contains an exact sound Resource version plus:

- `startMs`
- `durationMs`
- `fadeInMs`
- `fadeOutMs`
- `gainDb`

A sound cue must reference a ready `project.sound_effect_audio` Resource owned by
the same user and project. Its source media must have a known duration at least as
long as `durationMs`; `startMs + durationMs` must not exceed the one source video's
known duration; fades cannot exceed cue duration; and a Resource version may occur
only once in `soundCues`. Violations fail during planning before a Task or output
Resource is created.

Timed-cue merge mode is selected when either `musicCues` or `soundCues` is present.
It requires exactly one already-merged source video, `audioMode: 'preserve'`, and
no `backgroundMusic` or `replacementAudio`. It permits both cue lists in the same
request. When neither list is present, the existing explicit audio modes keep their
current contract.

## Rendering

The handler resolves frozen music and sound references once, materializes their
storage objects into its scratch directory, and invokes one FFmpeg filtergraph.

1. Normalize and concatenate the source-video audio into the main/dialogue bus.
2. Place each music cue with trim, resample, fade, gain, delay, and a digital-silence
   base; mix it into the BGM bus and duck that bus against the main bus.
3. Place each sound cue with the same timeline filters but a sound-effect loudness
   target; mix it into an independent effects bus without reusing BGM ducking.
4. Mix main, ducked BGM, and effects buses for the exact video duration; apply one
   final limiter; mux that audio with the already-stitched video stream.

Cue gaps are digital silence. Overlaps are explicit deterministic mixes. A missing
or unreadable frozen input, absent source duration, FFmpeg failure, cancellation,
or provider artifact mismatch fails the existing Task normally; it never writes a
partial Resource or silently omits a cue.

## Protocol cutover

This changes the durable video-merge payload shape and execution semantics. Before
implementation, inspect queued, processing, failed-retryable, and cancelled
video-merge Tasks. If any carry the current contract, drain or explicitly reject
them before changing the protocol revision; do not run a second compatibility
handler. Once the audit is clean, introduce one new payload revision and delete the
old music-only rendering branch while retaining the same public `musicCues` feature
as the BGM input of the unified timed-cue path.

## Verification

Use an independent FFmpeg fixture with a one-video timeline and four known sound
clips to probe the final audio duration and verify each cue's start/end placement.
Also verify: simultaneous BGM plus sound cues; source audio present and absent;
overlap; invalid cue bounds; short source audio; stale reference; no queued legacy
Tasks; focused contract tests; typecheck; and the applicable full contract suite.
