# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions are published automatically by [semantic-release](https://github.com/semantic-release/semantic-release) on push to `main`. New release entries are prepended here automatically. Anything currently under `[Unreleased]` will be folded into the next published version.

## [Unreleased]

### Added

- `devtun doctor` command runs read-only health checks against your config, Cloudflare token, zone, tunnel, fallback origin, custom hostnames (with orphan detection for hostnames not on the current `devSubdomain`), and the local Docker stack. Use it as the first step when diagnosing routing or SSL issues.
- `--force` flag on `devtun config set` to override safety checks when changing `domain` or `devSubdomain`.
- `--restart`, `--no-restart`, and `--yes` (alias `-y`) flags on `devtun add` and `devtun remove`, so the commands can run unattended without prompting. Outside a TTY (piped input, CI, automation), the commands now default to not restarting containers, while the Cloudflare side is still updated. Inside a TTY, the existing prompt still appears unless a flag is passed.
- `--json` flag on `devtun list`, `devtun status` (both forms), `devtun doctor`, `devtun config`, and `devtun config get`. Emits a single JSON document on stdout, designed for piping into `jq`. Exit codes are unchanged. `tunnelToken` is never included in JSON output; `devtun config get tunnelToken` is rejected.
- `--help` (alias `-h`) on every command. Prints a man-style page with synopsis, arguments, flags, environment variables, exit codes, and worked examples. `--json --help` returns the help document as JSON so tooling can introspect available flags.
- `devtun setup` accepts all initial values via flags (`--domain`, `--dev-subdomain`, `--tunnel-name`, `--cf-token-source`) or env vars (`DEVTUN_DOMAIN`, `DEVTUN_DEV_SUBDOMAIN`, `DEVTUN_TUNNEL_NAME`). `--yes` auto-confirms destructive prompts. In a non-TTY context with missing required values, setup fails with a clear "pass --foo or set DEVTUN_FOO" message instead of hanging. When Cloudflare for SaaS needs to be enabled in the dashboard, setup exits with code 2 and prints the dashboard URL.
- New "Scripting and CI" section in the README documenting the non-interactive behaviour, flag semantics, JSON output shapes, per-command help, and the unattended setup flow.

### Changed

- `devtun config set domain <new>` now verifies the Cloudflare API token can access the new zone before writing, refuses the change if custom hostnames are still registered on the old zone (unless `--force`), and clears the cached `zoneId`, `accountId`, `tunnelId`, and `tunnelToken` so the next `devtun setup` re-resolves them against the new zone.
- `devtun config set devSubdomain <new>` now refuses the change if custom hostnames are still registered on the old subdomain (unless `--force`).
- `devtun config set tunnelName <new>` now clears the cached `tunnelId` and `tunnelToken` and warns that the old tunnel is still on Cloudflare.

### Fixed

- `devtun remove` now strips the `traefik.enable: true` label when it removes the last router from a service. Previously a stale `traefik.enable` lingered, leaving the service marked as Traefik-exposed with no routes.
- `devtun remove` now also strips the implicit `networks: [default]` entry that `devtun add` adds when creating a fresh service, so the `docker-compose.override.yml` is fully cleaned up (and deleted, if empty) when the last project is removed.

### Documentation

- New README section "Changing your domain or subdomain" with the safe migration procedure.
- Troubleshooting section now opens with "first step: run `devtun doctor`".

### Internal

- Vitest + MSW test suite covering compose YAML manipulation, validation, and integration tests for `add`, `remove`, `config set`, and `doctor` against an in-memory Cloudflare mock. Run with `npm test`.
- New GitHub Actions `CI` workflow runs lint + tests + build on every pull request and non-`main` push.
- `publish.yml` now runs `npm test` before releasing, gating publishes on the suite.

## [1.0.1] - 2026-05-07

### Fixed

- Explicitly include `README.md` in the published npm package's `files` list. ([7caf069](https://github.com/bendechrai/devtunnel/commit/7caf069182cd5bec56ddf14f0336ccc500bea4ac))

## [1.0.0] - 2026-05-07

### Changed

- **BREAKING:** `devtun add <name>` now requires the service name and port as explicit arguments: `devtun add <name> <service> <port>`. This removes the implicit "first service in compose, port 3000" heuristic in favour of a config that's unambiguous when projects have multiple services. ([6cfaab5](https://github.com/bendechrai/devtunnel/commit/6cfaab55c4e02208d7712e17590e2bc0f87439ab))

### Migration

- Update any scripts that called `devtun add myapp` to pass the service and port: `devtun add myapp web 3000`.

## [0.2.1] - 2026-05-07

### Fixed

- Upgrade the Traefik image to v3 for compatibility with current Docker API responses. v2 was failing to discover containers on newer Docker Engine releases. ([64367a1](https://github.com/bendechrai/devtunnel/commit/64367a111c1ca3286dd131933853f384f870c741))

## [0.2.0] - 2026-04-01

### Added

- Traefik middleware injects `CDN-Cache-Control: no-store` on every routed response, preventing Cloudflare's edge from caching local dev responses. ([94a9b0f](https://github.com/bendechrai/devtunnel/commit/94a9b0f0f2371a6c33838802d334d18a5c543d46))

## [0.1.0] - 2026-03-08

### Added

- Initial release. CLI for giving local Docker containers public HTTPS URLs via Cloudflare Tunnel + Traefik + Cloudflare for SaaS per-hostname certificates.
- `devtun setup` walks through Cloudflare zone lookup, tunnel creation, SSL mode + Universal SSL configuration, Cloudflare for SaaS fallback origin, and starts the Traefik + cloudflared stack via Docker Compose.
- `devtun add <name>` registers a project: creates a CNAME, requests an edge SSL certificate via Cloudflare for SaaS, and writes Traefik routing labels into the project's `docker-compose.override.yml`.
- `devtun remove`, `devtun list`, `devtun status`, `devtun up`, `devtun down`, `devtun config`, `devtun autostart` for managing projects and the infrastructure stack.
- Cloudflare API token resolution from environment variable, 1Password CLI (`op://` reference), or literal value in config.
- macOS LaunchAgent and Linux systemd user unit support via `devtun autostart enable`.
- Semantic-release pipeline publishing to npm with provenance attestations on push to `main`.

[Unreleased]: https://github.com/bendechrai/devtunnel/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/bendechrai/devtunnel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bendechrai/devtunnel/compare/v0.2.1...v1.0.0
[0.2.1]: https://github.com/bendechrai/devtunnel/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/bendechrai/devtunnel/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/bendechrai/devtunnel/releases/tag/v0.1.0
