# Timed Environment-Sound Cues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Render independently generated environment-sound Resources at exact cue windows into the finished video while retaining independent BGM and main-audio buses.

**Architecture:** The 'merge_videos' operation freezes music and sound cue placements from exact Resource versions into one v2 video-merge payload. The existing video-merge Task remains the only executor and calls one FFmpeg filtergraph that builds main, ducked-BGM, and sound-effect buses before final limiting and muxing.

**Tech Stack:** TypeScript, Zod, Prisma, Temporal Task handler, FFmpeg/ffprobe, Vitest.

## Global Constraints

- Background music, environment sound, and voice/source audio remain distinct modalities and buses.
- 'merge_videos' is the only planner; the existing video-merge handler is the only executor; the terminal materializer is the only durable writer.
- Each cue freezes resource identity, start, duration, fades, and gain before Task creation.
- Timed cues require one source video, 'audioMode: preserve', and no background-music or replacement-audio field.
- Do not add a ComfyUI mixing workflow, a second Task type, a fallback, or an old-payload compatibility handler.
- Keep '.superpowers/' untracked and untouched.

---

### Task 1: Audit the v1 cutover boundary

**Files:**
- Modify: none.

**Interfaces:**
- Consumes: 'TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE' and persisted Task status.
- Produces: proof that no queued, processing, failed, or cancelled v1 Task can reach the new handler.

- [ ] **Step 1: Run the read-only audit**

    @'
    import { prisma } from './src/lib/prisma'
    import { TASK_TYPE } from './src/lib/task/types'
    void (async () => {
      const tasks = await prisma.task.findMany({
        where: { type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE, status: { in: ['queued', 'processing', 'failed', 'canceled'] } },
        select: { id: true, status: true, payload: true },
      })
      console.log(JSON.stringify(tasks))
      await prisma.$disconnect()
    })()
    '@ | npx.cmd tsx --env-file=.env -

Expected: '[]'. If any record remains, stop and report its ID, status, and protocol.

- [ ] **Step 2: Preserve the audit evidence**

Do not write database data or create an audit artifact. Include the fresh command output in the final delivery.

### Task 2: Freeze sound cues in the single v2 merge contract

**Files:**
- Modify: 'src/lib/workspace-resource/video-merge-contract.ts'
- Modify: 'src/lib/operations/domains/workspace-resource/video-merge-ops.ts'
- Modify: 'tests/contracts/video-merge-audio-mode.contract.test.ts'

**Interfaces:**
- Consumes: public 'merge_videos' input, exact WorkspaceResource references, source-video and generated-sound media durations.
- Produces: a 'workspace_resource_video_merge_v2' payload with separate 'musicCues' and 'soundCues'.

- [ ] **Step 1: Write the failing contract tests**

    expect(operation.inputSchema.safeParse({
      name: 'timed ambience',
      videos: [video('video_one')],
      audioMode: 'preserve',
      soundCues: [{
        resourceId: 'sound_one', contentVersion: 1,
        startMs: 0, durationMs: 26_000,
        fadeInMs: 300, fadeOutMs: 500, gainDb: -8,
      }],
    }).success).toBe(true)

    expect(operation.inputSchema.safeParse({
      name: 'invalid ambience',
      videos: [video('video_one'), video('video_two')],
      audioMode: 'preserve',
      soundCues: [{
        resourceId: 'sound_one', contentVersion: 1,
        startMs: 0, durationMs: 1_000,
        fadeInMs: 0, fadeOutMs: 0, gainDb: 0,
      }],
    }).success).toBe(false)

Also add a payload case accepting protocol v2, role 'sound_effect_audio', and a matching frozen 'soundCues' position; assert that a sound cue at a BGM position is rejected.

- [ ] **Step 2: Run the test to verify RED**

    npx.cmd vitest run tests/contracts/video-merge-audio-mode.contract.test.ts --exclude ".worktrees/**"

Expected: failure because protocol v2, sound cue input, and sound role do not exist.

- [ ] **Step 3: Implement the strict contract and planner**

Export one strict cue-placement schema with 'inputPosition', 'startMs', 'durationMs', 'fadeInMs', 'fadeOutMs', and 'gainDb'. Add 'sound_effect_audio' as the frozen input role, require cue positions to match exactly their own role, and enforce a combined maximum of 50 timed inputs. In the public operation, add the same placement fields to 'soundCues'; resolve each with media type audio and schema 'project.sound_effect_audio'. Resolve the one source-video duration and every sound duration before reservation, rejecting unknown, short, or out-of-timeline audio. Freeze sound placements, include both cue lists in the input hash, emit only protocol v2 with 'mergeMode: timed_cues', and update write authority from v6 to v7.

- [ ] **Step 4: Run the test to verify GREEN**

    npx.cmd vitest run tests/contracts/video-merge-audio-mode.contract.test.ts --exclude ".worktrees/**"

Expected: pass for the new cue contract and the existing explicit modes.

- [ ] **Step 5: Commit**

    git add src/lib/workspace-resource/video-merge-contract.ts src/lib/operations/domains/workspace-resource/video-merge-ops.ts tests/contracts/video-merge-audio-mode.contract.test.ts
    git commit -m "feat(video): freeze timed environment sound cues"

### Task 3: Render independent BGM and environment-sound buses

**Files:**
- Modify: 'src/lib/video-compose/video-merge-audio.ts'
- Modify: 'tests/unit/video-compose/music-cue-timeline.test.ts'

**Interfaces:**
- Consumes: 'VideoMergeTimedAudioCueInput { audioPath, startMs, durationMs, fadeInMs, fadeOutMs, gainDb }'.
- Produces: 'muxVideoMergeTimedAudioCues' that accepts 'musicCues' and 'soundCues' and emits exactly one audio stream.

- [ ] **Step 1: Write the failing real-FFmpeg test**

    await muxVideoMergeTimedAudioCues({
      runCommand, stitchedPath, mainAudioPath, hasSourceAudio: false,
      musicCues: [],
      soundCues: [
        { audioPath: firstSoundPath, startMs: 1_000, durationMs: 1_000, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 },
        { audioPath: secondSoundPath, startMs: 4_000, durationMs: 1_000, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 },
      ],
      outputPath, durationSeconds: 6,
    })

Generate two distinct sine clips, decode output PCM, assert low energy at 0.2-0.8, 2.2-3.8, and 5.2-5.8 seconds, high energy at 1.2-1.8 and 4.2-4.8 seconds, and duration near six seconds.

- [ ] **Step 2: Run the test to verify RED**

    npx.cmd vitest run tests/unit/video-compose/music-cue-timeline.test.ts --exclude ".worktrees/**"

Expected: failure because 'muxVideoMergeTimedAudioCues' is absent.

- [ ] **Step 3: Implement the unified renderer**

Replace 'muxVideoMergeMusicCues' with 'muxVideoMergeTimedAudioCues'. Build every cue through trim, 48 kHz stereo resample, loudness normalization, fades, gain, exact-duration padding, and delay. Preserve existing BGM ducking against the main bus. Build an independent sound bus using target I=-20 LUFS, TP=-3 dB, LRA=11, with no BGM sidechain compression. Use silence-backed buses, one final amix for main plus ducked BGM plus sound effects, exact output duration, and one 'alimiter=limit=0.95'.

- [ ] **Step 4: Run the test to verify GREEN**

    npx.cmd vitest run tests/unit/video-compose/music-cue-timeline.test.ts --exclude ".worktrees/**"

Expected: real FFmpeg test passes.

- [ ] **Step 5: Commit**

    git add src/lib/video-compose/video-merge-audio.ts tests/unit/video-compose/music-cue-timeline.test.ts
    git commit -m "feat(video): mix timed environment sound cues"

### Task 4: Consume the frozen v2 payload in the sole video-merge handler

**Files:**
- Modify: 'src/lib/task/execution/handlers/workspace-resource-video-merge.ts'
- Modify: 'tests/contracts/video-merge-audio-mode.contract.test.ts'

**Interfaces:**
- Consumes: v2 payload cue positions and 'muxVideoMergeTimedAudioCues'.
- Produces: the existing terminal Task result with all cue inputs rendered before persistence.

- [ ] **Step 1: Write the failing handler-contract test**

Add a payload containing both cue lists and assert parsing preserves distinct 'bgm_audio' and 'sound_effect_audio' positions. Assert the same sound position cannot appear twice.

- [ ] **Step 2: Run the focused test to verify RED**

    npx.cmd vitest run tests/contracts/video-merge-audio-mode.contract.test.ts --exclude ".worktrees/**"

Expected: failure before the v2 handler contract is connected.

- [ ] **Step 3: Implement handler consumption**

Resolve BGM and sound references by their frozen cue positions, materialize each storage object once in the Task scratch directory, and call 'muxVideoMergeTimedAudioCues' whenever either cue list is non-empty. Retain 'muxVideoMergeFinalAudio' only for no-cue explicit modes. Delete the music-only handler branch and throw explicit errors for missing frozen positions or placements.

- [ ] **Step 4: Run focused tests to verify GREEN**

    npx.cmd vitest run tests/contracts/video-merge-audio-mode.contract.test.ts tests/unit/video-compose/music-cue-timeline.test.ts --exclude ".worktrees/**"

Expected: both files pass.

- [ ] **Step 5: Commit**

    git add src/lib/task/execution/handlers/workspace-resource-video-merge.ts tests/contracts/video-merge-audio-mode.contract.test.ts
    git commit -m "feat(video): render frozen timed sound cues"

### Task 5: Verify the production trigger path

**Files:**
- Modify: none unless verification exposes a defect.
- Test: 'tests/contracts/video-merge-audio-mode.contract.test.ts'
- Test: 'tests/unit/video-compose/music-cue-timeline.test.ts'
- Test: 'tests/integration/video-compose/video-merge-audio-modes.integration.test.ts'

**Interfaces:**
- Consumes: v2 planner, handler, and FFmpeg renderer.
- Produces: fresh evidence for cue placement, type safety, and legacy cutover safety.

- [ ] **Step 1: Run focused trigger-path verification**

    npx.cmd vitest run tests/contracts/video-merge-audio-mode.contract.test.ts tests/unit/video-compose/music-cue-timeline.test.ts tests/integration/video-compose/video-merge-audio-modes.integration.test.ts --exclude ".worktrees/**"

Expected: pass, including real FFmpeg cue placement and existing explicit audio modes.

- [ ] **Step 2: Run shared verification**

    npm.cmd run typecheck
    npx.cmd vitest run tests/contracts --exclude ".worktrees/**"
    git diff --check

Expected: every command exits 0. Report an unrelated baseline failure separately rather than changing unrelated behavior.

- [ ] **Step 3: Commit a verification-only correction only if one was necessary**

If verification requires a correction, stage only its direct files and commit with 'fix(video): ...'. Otherwise, make no empty commit.
