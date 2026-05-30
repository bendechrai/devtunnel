# devtun

Public HTTPS URLs for local Docker containers. Run your projects locally, access them from anywhere at `https://<project>.<your-dev-subdomain>`.

Uses **Traefik** for automatic reverse proxy discovery, a **Cloudflare Tunnel** to expose it to the internet, and **Cloudflare for SaaS** to issue per-project edge SSL certificates.

## Architecture

```mermaid
sequenceDiagram
    participant Browser
    participant CF as Cloudflare Edge
    participant CD as cloudflared
    participant T as Traefik
    participant App as Project Container

    Browser->>CF: https://app.dev.example.com
    Note over CF: TLS termination<br/>(SaaS custom hostname)
    CF->>CD: Tunnel (QUIC)
    CD->>T: HTTP
    Note over T: Route by Host() label
    T->>App: HTTP
    App-->>Browser: Response
```

Cloudflare handles TLS at the edge. The tunnel sends plain HTTP to Traefik. Traefik routes to your project container based on `Host()` labels. No local certificates to manage.

### Why Cloudflare for SaaS?

Cloudflare's free Universal SSL covers `*.example.com` but not `*.dev.example.com` -- wildcard certs only go one level deep. Advanced Certificate Manager ($10/mo) would cover it, but Cloudflare for SaaS issues individual edge SSL certificates per hostname for free (up to 100). devtun automates this completely.

## Prerequisites

- Node.js 18+
- Docker

```bash
npm install -g devtun
```

### Cloudflare API token

Create a Custom API Token in your [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) with:

**Token Name:** devtun

**Permissions:**

| Type | Permission           | Access |
| ---- | -------------------- | ------ |
| Zone | Zone Settings        | Edit   |
| Zone | SSL and Certificates | Edit   |
| Zone | DNS                  | Edit   |

**Zone Resources:**

| Type    | Which Zones   | Zone Name     |
| ------- | ------------- | ------------- |
| Include | Specific Zone | `example.com` |

You can provide the token as:
- An environment variable: `CLOUDFLARE_API_TOKEN`
- A [1Password CLI](https://developer.1password.com/docs/cli/) reference: `op://Vault/Item/field`
- A literal value in your config

## Setup

```bash
devtun setup
```

The interactive setup walks you through configuration and handles everything in order:

1. Creates your config (`~/.devtun/config.json`)
2. Checks Docker is running
3. Looks up your Cloudflare zone
4. Creates a Cloudflare Tunnel (or reuses an existing one)
5. Configures SSL mode and Universal SSL
6. Enables Cloudflare for SaaS and sets up the fallback origin
7. Generates a Docker Compose file and starts Traefik + the tunnel

If setup is interrupted partway through, just run `devtun setup` again -- each step checks whether it's already been completed.

The only manual step is enabling Cloudflare for SaaS in the dashboard the first time. The setup detects this and gives you the URL.

## Usage

### Register a project

From your project directory:

```bash
devtun add myapp web 3000
```

This:
1. Creates a DNS record and edge SSL certificate for `myapp.<your-dev-subdomain>`
2. Generates a `docker-compose.override.yml` with Traefik labels routing to the `web` service on port `3000`
3. Optionally restarts your containers

You can map multiple hostnames to different services in the same project:

```bash
devtun add myapp web 3000
devtun add myapp-mail mail 8025
```

SSL typically activates within seconds.

### Manage projects

```bash
devtun add <name> <svc> <port>  # Register hostname routing to service on port
devtun list              # List all registered project hostnames
devtun status <name>     # Check SSL and routing status
devtun remove <name>     # Remove hostname, DNS record, and labels
```

### Infrastructure

```bash
devtun up                # Start Traefik + tunnel containers
devtun down              # Stop Traefik + tunnel containers
devtun autostart enable  # Start on login (macOS/Linux)
devtun doctor            # Health-check config, Cloudflare, Docker
```

### Configuration

```bash
devtun config            # Show current configuration
devtun config set <k> <v>  # Update a config value
devtun config get <key>  # Get a config value
```

### Changing your domain or subdomain

If you need to move all your projects to a new domain or subdomain, the order matters: `devtun remove` uses the *current* config to know which Cloudflare zone to clean up.

1. List what's registered: `devtun list`
2. For each project, run `devtun remove <name>` from that project's directory. This deletes the Cloudflare custom hostname, DNS record, and TXT verification record, and cleans the project's `docker-compose.override.yml`.
3. Change the config: `devtun config set domain new.example.com` (and `devtun config set devSubdomain dev.new.example.com` if needed). `devtun` will verify your Cloudflare API token has access to the new zone, refuse the change if any custom hostnames are still registered on the old zone (use `--force` to override), and clear the cached `zoneId`/`tunnelId` so setup re-resolves them.
4. Run `devtun setup` again. It'll create a new tunnel and SaaS setup for the new zone.
5. Re-add each project: `devtun add <name> <service> <port>`.

If you skipped step 2, the custom hostnames on the old zone become orphans (they'll keep using slots toward your 100-hostname SaaS free limit). Clean them up in the Cloudflare dashboard, or temporarily restore the old domain in `~/.devtun/config.json`, run `devtun remove` for each, then switch back.

Run `devtun doctor` at any point to verify the current state of your config, tunnel, and zone.

### Full workflow for a new project

```bash
# One-time setup (if not done already):
devtun setup

# In your project directory:
devtun add myapp web 3000

# Done -- https://myapp.dev.example.com/ is live
```

## How it works

When you run `devtun add`, it:
- Creates a CNAME record pointing `myapp.dev.example.com` to your tunnel's fallback origin
- Registers a Cloudflare for SaaS custom hostname, which triggers edge SSL certificate issuance
- Writes a `docker-compose.override.yml` in your project with Traefik routing labels and the `devtun` network

Your project container connects to Traefik via the shared `devtun` Docker network. Traefik discovers it by its labels, and the Cloudflare Tunnel forwards incoming requests from the edge.

## Dashboard

Traefik dashboard: http://localhost:8080 -- shows all discovered routes and their health.

## Releasing

Pushes to `main` automatically publish to npm via [semantic-release](https://github.com/semantic-release/semantic-release). The version bump is determined by commit messages:

- `fix: ...` - patch release (0.0.x)
- `feat: ...` - minor release (0.x.0)
- `feat!: ...` or `BREAKING CHANGE:` in the commit body - major release (x.0.0)

Commits that don't match a release type (e.g. `chore:`, `docs:`, `ci:`) won't trigger a release.

The pipeline builds, type-checks, verifies dependency signatures, then publishes with npm provenance attestations. It also auto-generates a CHANGELOG and commits the version bump back to the repo.

## Troubleshooting

**First step for any problem**: run `devtun doctor`. It validates your Cloudflare token, checks that your tunnel and zone are still in sync with your config, lists any orphaned custom hostnames (registered on a subdomain other than your current one), and reports whether the Docker stack is up.

**522 error (origin unreachable)**: The tunnel can't reach Traefik, or Traefik can't reach your container. Check that `devtun up` has been run, and that your project container is on the `devtun` network. Run `docker network inspect devtun` to see connected containers.

**SSL handshake failure**: The hostname probably doesn't have a custom hostname registered. Run `devtun status <name>` to check, or `devtun add <name> <service> <port>` to register it.

**Tunnel not connecting**: Run `docker compose logs tunnel` in `~/.devtun/`. If the tunnel token is missing, re-run `devtun setup`.

**Project not routing**: Check the Traefik dashboard at http://localhost:8080. Verify your project has a `docker-compose.override.yml` with the correct labels and is on the `devtun` network. Make sure entrypoints is `web` (not `websecure`).

**Starting fresh**:

```bash
devtun down
rm -rf ~/.devtun
devtun setup
```
