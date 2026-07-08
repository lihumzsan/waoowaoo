# Long-form E2E Runner

This runner drives the long-form video workflow through the same HTTP APIs used by the app. It does not call operation side-effect functions directly.

Run:

```bash
npm run e2e:long-form -- --mode=live --target=assets_approved
```

Required authentication: set `E2E_BASE_URL` plus either `E2E_USERNAME` and `E2E_PASSWORD`, or provide a session cookie.

or:

```bash
E2E_SESSION_COOKIE='next-auth.session-token=...'
```

Target stages are selectable with `--target`. Examples:

- `bible_ready`
- `style_previews_ready`
- `assets_approved`
- `video_plan_ready`
- `final_video_ready`

`--generation=plan-only` is allowed only for targets that do not require real media generation. `final_video_ready`, `videos_ready`, `chapters_rendered`, and `music_ready` require `--generation=real`.

The runner classifies outcomes:

- `PASS`: target reached.
- `SYSTEM_FAIL`: workflow, state, or task invariant failed.
- `PROVIDER_FAIL`: all terminal failures came from external provider/network boundaries.
- `QUALITY_WARN`: reserved for non-blocking content quality checks.

Reports are written to `artifacts/e2e-long-form` by default.
