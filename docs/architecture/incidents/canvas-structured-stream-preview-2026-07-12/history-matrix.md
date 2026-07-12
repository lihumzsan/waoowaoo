# History regression matrix

| Historical change | Intended correction | Escaped seam | Current defense |
| --- | --- | --- | --- |
| `931ab59c3` production-plan structured preview | Add step-specific Canvas adapters | Adapters parsed then-current normalized item shapes | Raw contract conformance in the existing structured-stream runtime suite |
| `ac3708a9b` bind ledger events to beats | Model emits `beatId`; server derives final source range | Ledger preview retained `ledgerEventSchema` and still required `sourceStart/sourceEnd` | Adapter imports the same `rawEditBibleLedgerEventSchema` as the production normalizer |
| source-anchor normalization for beats and emotion | Model emits `sourceAnchor`; server derives final range | Beat/emotion preview used final normalized schemas | Preview adapters use raw beat/emotional-cue schemas; formal Query remains normalized |
| `854c888cd` single Canvas lifecycle resolver | Make stream, Task and persisted facts explicit | Resolver still granted preview parser error business failure authority | Stream fact contains presentation only; Task/resource terminal exclusively owns failure |
| Final Golden mainline | Prove empty project reaches durable final video | Immediate one-chunk local model plus terminal-only oracle missed processing-time UI divergence | Focused fail-before sequence now covers raw incremental contract; future delayed browser observation is a named pacing boundary |
