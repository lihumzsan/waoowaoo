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
npx tsx scripts/music-score-demo/render-sampled.ts
npx tsx scripts/music-score-demo/render-sampled.ts scripts/music-score-demo/scores/05-chinese-folk-cthulhu.json
```

The first command renders score 04 by default; the second renders the Chinese-folk cosmic-horror score. The parameterized entry downloads the pinned MIT-licensed `MuseScore_General.sf3` from the official MuseScore mirror, verifies its SHA-256 hash, renders each instrument as a separate FluidSynth stem, and masters the stems into 48 kHz/24-bit WAV plus 256 kbps MP3. The SoundFont and its license stay under ignored `tmp/music-score-demo-assets/`.

## Public-domain score / renderer ceiling benchmark

This A/B benchmark holds the MIDI and mastering constant while changing only the renderer and piano library:

- Source: Frédéric Chopin, Prelude Op. 28 No. 4, public-domain MIDI from [Mutopia](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=921).
- A: the existing lightweight MuseScore General SoundFont rendered by FluidSynth.
- B: Alexander Holm's 16-velocity-layer [Salamander Grand Piano](https://sfzlab.github.io/sfz-website/instruments/alexander-holm/salamander-grand-piano/), licensed CC BY 3.0, rendered by the BSD-licensed `sfizz_render`.

Build the pinned official sfizz renderer once, then run the single benchmark entry:

```bash
npx tsx scripts/music-score-demo/setup-sfizz-render.ts
npx tsx scripts/music-score-demo/render-public-domain-benchmark.ts
```

The setup entry checks out an exact official sfizz commit and applies a narrowly checked compatibility edit for current Apple Clang before building under ignored `tmp/`. The renderer downloads both pinned sources, verifies their SHA-256 hashes, and writes matched 48 kHz/24-bit WAV plus 256 kbps MP3 files under ignored `tmp/music-benchmark-output/`. Both versions are trimmed to the same duration and use two-pass linear loudness normalization, so dynamics are preserved rather than compressed into a misleading match. Set `SFIZZ_RENDER_PATH` when the binary is outside the documented build directory.

To isolate event/performance quality as a third variable, add a real Disklavier performance from [Google's MAESTRO v3 dataset](https://magenta.tensorflow.org/datasets/maestro):

```bash
npx tsx scripts/music-score-demo/render-public-domain-benchmark.ts --include-maestro-noncommercial
```

Variant C renders a competition performance of Alexander Scriabin's Etude Op. 8 No. 13 through the same Salamander/sfizz path. MAESTRO includes note velocity and pedal positions captured by a Yamaha Disklavier, but it is CC BY-NC-SA 4.0. Variant C is therefore an internal ceiling benchmark only and must not be shipped as a commercial product asset.

## Schemes

1. `note-events/v1`: every note is explicit. Maximum control, largest model output.
2. `motif-arrangement/v1`: motifs, harmony, and arrangement are explicit; the compiler expands them to notes. This is the recommended production contract.
3. `emotion-procedural/v1`: only emotion, intensity, mode, seed, and instrument palette are explicit. The deterministic arranger writes the notes.
4. `cinematic-continuous/v1`: explicit voice-led harmony, continuous arpeggio layers, long-form phrases, orchestral instrumentation, sampled stem rendering, and mastering. This is the listening-quality upper-bound demonstration.

All sources are strictly parsed, compiled to one `NoteEvent` representation, exported to MIDI, and rendered to 48 kHz stereo PCM by the TypeScript synthesizer in this directory. The same source and seed produce the same output.
