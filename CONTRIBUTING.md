# Contributing / 参与贡献

感谢你帮助改进 waoowaoo。请先搜索已有 Issue；安全问题不要使用公开 Issue，请阅读
[`SECURITY.md`](SECURITY.md)。

## Development setup

```bash
git clone https://github.com/waooAI/waoowaoo.git
cd waoowaoo
sh scripts/self-hosted/prepare-env.sh
# Edit the required S3_* values in .env.
npm install
npm run dev
```

更多说明见[自托管快速开始](docs/self-hosted/quickstart.md)。

## Before changing code

- Read [`AGENTS.md`](AGENTS.md) and [`docs/architecture/README.md`](docs/architecture/README.md).
- Find the existing authoritative entry, shared type, registry, and module contract before adding a new path.
- Do not add compatibility tracks, silent fallbacks, duplicate writers, or a second lifecycle interpreter.
- Keep user-visible copy in i18n resources; do not hard-code one language in product code.
- Never commit `.env`, credentials, production data, logs, certificates, or private Cloud content.

## Pull requests

Keep each PR focused on one bug fix, feature slice, refactor stage, or documentation update. Explain:

- what changed and why;
- the authoritative entry reused or completed;
- user or developer impact;
- validation commands actually run and remaining blind spots;
- migration, rollout, or recovery requirements when applicable.

Run the narrowest meaningful checks. The normal static gate is:

```bash
npm run verify:push
npm run security:secrets:repo
```

Production or deployment changes should also validate `npm run build` and `docker compose config --quiet`. Do not add tests that merely mock the implementation and assert its own call pattern.

By contributing, you confirm that you have the right to submit the work under the repository's license.
