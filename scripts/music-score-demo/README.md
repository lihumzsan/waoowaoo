# Code-rendered symbolic music demo

This isolated prototype compares three text-to-music representations against the same 24-second emotional curve. It does not call Lyria or any external music-generation API.

## Render

```bash
npx tsx scripts/music-score-demo/render.ts
```

The command writes WAV, MP3, and standard MIDI files to `tmp/music-score-demo/`.

## Schemes

1. `note-events/v1`: every note is explicit. Maximum control, largest model output.
2. `motif-arrangement/v1`: motifs, harmony, and arrangement are explicit; the compiler expands them to notes. This is the recommended production contract.
3. `emotion-procedural/v1`: only emotion, intensity, mode, seed, and instrument palette are explicit. The deterministic arranger writes the notes.

All sources are strictly parsed, compiled to one `NoteEvent` representation, exported to MIDI, and rendered to 48 kHz stereo PCM by the TypeScript synthesizer in this directory. The same source and seed produce the same output.
