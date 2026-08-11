<p align="center">
  <img src="public/banner.png" alt="waoowaoo" width="640">
</p>

<h1 align="center">waoowaoo AI Video Studio</h1>

<p align="center">
  A self-hosted AI production workspace for scripts, creative direction, visual assets, video segments, and sound design.
</p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="https://www.waoowaoo.com/">Online demo</a> ·
  <a href="https://github.com/waooAI/waoowaoo/issues">Issues</a>
</p>

<p align="center">
  <a href="https://github.com/waooAI/waoowaoo/actions/workflows/verify.yml"><img alt="Verify" src="https://github.com/waooAI/waoowaoo/actions/workflows/verify.yml/badge.svg"></a>
  <a href="https://github.com/waooAI/waoowaoo/pkgs/container/waoowaoo"><img alt="Container" src="https://img.shields.io/badge/container-ghcr.io-blue"></a>
</p>

> [!IMPORTANT]
> The self-hosted edition is currently a **Developer Preview**. Use a fresh installation in a controlled network; it is not yet recommended for public multi-tenant production.
> Model quality, cost, concurrency, and availability are determined by the third-party AI providers you configure.

## What it does

- **Script and story structure** — turn source text into a structured production script.
- **Creative direction** — align visual style, color, materials, cinematography, and sound direction.
- **Visual assets** — manage reusable characters, locations, props, and reference media.
- **Image and video generation** — generate and edit images, then produce video segments.
- **Sound design** — create dialogue, sound, or music when supported by the selected model.
- **Visual workspace** — inspect resources, dependencies, and task state on a canvas.
- **Durable execution** — use Temporal for long-running generation, recovery, and final delivery.
- **Bring your own models** — each user configures provider API keys and models in the web UI.

Capabilities depend on the exact provider and model. A provider may not support every text, image, video, voice, and music role.

## Runtime architecture

```text
Browser
  │
  ▼
waoowaoo Web ───────────────► User-configured AI providers
  │                                  ▲
  ├── MySQL: project/task facts      │
  ├── Redis: live transport/cache    │
  ├── Temporal: durable execution ───┘
  ├── S3: image, video, audio objects
  └── Codex Runtime: isolated project agents
```

The application, MySQL, Redis, Temporal, Workers, and Codex Runtime run in Docker. Media uses external S3-compatible storage because third-party generation services need HTTPS access to input assets.

## Local evaluation

### Requirements

- Docker Engine or Docker Desktop with Docker Compose v2.
- Node.js 22 and npm.
- 4 CPU cores, 8 GB RAM, and 20 GB free disk; 8 cores and 16 GB RAM are recommended.
- A pre-created S3-compatible bucket reachable over public HTTPS.

### Start

```bash
git clone https://github.com/waooAI/waoowaoo.git
cd waoowaoo

# Generate local database, Redis, auth, and encryption secrets.
# Existing .env files are never overwritten.
sh scripts/self-hosted/prepare-env.sh

# Edit .env and set at least S3_ENDPOINT, S3_UPLOAD_ENDPOINT, S3_BUCKET,
# S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm run dev` uses
`docker-compose.yml` and `docker-compose.dev.yml` to start the complete local container environment.

> [!CAUTION]
> Never run `docker compose down -v` unless you intentionally want to delete the database and persistent volumes.

Production-style self-hosting requires immutable application and Codex Runtime images plus the guarded Temporal Worker blue/green rollout. Read the [self-hosted quick start](docs/self-hosted/quickstart.md) instead of deploying the development command unchanged.

## First sign-in

1. Register a local account and sign in.
2. Open **Settings → API configuration**.
3. Add your own provider API key.
4. Select available models for Assistant, analysis, image, video, voice, and music roles.
5. Use the connection test to validate credentials and endpoints.
6. Create a project and start producing.

Self-hosted deployments use `DEPLOYMENT_EDITION=self-hosted` and
`PROVIDER_CREDENTIAL_MODE=user-key`. No platform model keys are bundled. Provider keys are encrypted before database storage with `API_ENCRYPTION_KEY`; back up `.env`, because existing keys cannot be decrypted if that encryption key is lost.

## Common errors

| Code | Meaning | Check first |
|---|---|---|
| `PROVIDER_AUTH_INVALID` | Provider credentials are invalid | API key, base URL, account status |
| `serverOverloaded` | The selected model is at capacity | Provider status, model capacity, retry later |
| `UND_ERR_CONNECT_TIMEOUT` | The provider connection could not be established in time | Network, proxy, DNS, provider endpoint |
| `PROVIDER_SUBMISSION_OUTCOME_UNKNOWN` | No definitive submission receipt was received | Check the provider task before resubmitting |
| `API_ENCRYPTION_KEY` errors | User keys cannot be encrypted or decrypted | `.env`, key replacement or loss |

The system does not automatically resubmit expensive media work after `PROVIDER_SUBMISSION_OUTCOME_UNKNOWN`, because the provider may already have accepted it. See [troubleshooting](docs/self-hosted/troubleshooting.md) for more.

## Data and privacy

- Projects, tasks, and user configuration are stored in your MySQL database.
- Images, videos, and audio are stored in your configured S3 bucket.
- Generation requests are sent to the third-party provider selected by the user.
- Provider retention, moderation, and pricing are governed by that provider's terms.
- Configure HTTPS, access control, backups, and network boundaries before public exposure.

## Known limitations

- This release is a Developer Preview intended for local or controlled-network use.
- External providers may be overloaded, rate-limited, unreachable, or reject content.
- Third-party OpenAI-compatible endpoints may not implement every asynchronous media protocol.
- Long Assistant conversations may consume a large model context.
- External S3-compatible object storage is required.

## Documentation

- [Self-hosted quick start](docs/self-hosted/quickstart.md)
- [Environment and infrastructure](docs/self-hosted/configuration.md)
- [Providers and model configuration](docs/self-hosted/providers.md)
- [Object storage](docs/self-hosted/storage.md)
- [Upgrades, backup, and recovery](docs/self-hosted/upgrades.md)
- [Troubleshooting](docs/self-hosted/troubleshooting.md)
- [Architecture](docs/self-hosted/architecture.md)

## Security and contributing

Do not post exploit details, real credentials, or user data in public issues. Report vulnerabilities through the private channel in [`SECURITY.md`](SECURITY.md). Bug reports, feature proposals, and pull requests are welcome; read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the repository architecture rules first.

## License

The code is licensed under [`AGPL-3.0-only`](LICENSE). If you provide a modified version to users over a network, review the corresponding-source obligations in section 13 of the AGPL. The code license does not grant trademark rights in the waoowaoo name, logo, or brand assets; see [`TRADEMARKS.md`](TRADEMARKS.md).

---

<p align="center">Made with ❤️ by the waoowaoo team</p>
