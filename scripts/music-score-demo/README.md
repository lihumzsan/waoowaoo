# Code-rendered symbolic music demo

This isolated prototype compares three text-to-music representations against the same 24-second emotional curve. It does not call Lyria or any external music-generation API.

## Render

```bash
npx tsx scripts/music-score-demo/render.ts
```

The command writes WAV, MP3, and standard MIDI files to `tmp/music-score-demo/`.

## Render the sampled upper-bound version

```bash
brew install fluid-synth
npx tsx scripts/music-score-demo/render-upper-bound.ts
```

This command downloads the pinned MIT-licensed `MuseScore_General.sf3` from the official MuseScore mirror, verifies its SHA-256 hash, renders each instrument as a separate FluidSynth stem, and masters the stems into 48 kHz/24-bit WAV plus 256 kbps MP3. The SoundFont and its license stay under ignored `tmp/music-score-demo-assets/`.

## Schemes

1. `note-events/v1`: every note is explicit. Maximum control, largest model output.
2. `motif-arrangement/v1`: motifs, harmony, and arrangement are explicit; the compiler expands them to notes. This is the recommended production contract.
3. `emotion-procedural/v1`: only emotion, intensity, mode, seed, and instrument palette are explicit. The deterministic arranger writes the notes.
4. `cinematic-continuous/v1`: explicit voice-led harmony, continuous arpeggio layers, long-form phrases, orchestral instrumentation, sampled stem rendering, and mastering. This is the listening-quality upper-bound demonstration.

All sources are strictly parsed, compiled to one `NoteEvent` representation, exported to MIDI, and rendered to 48 kHz stereo PCM by the TypeScript synthesizer in this directory. The same source and seed produce the same output.
