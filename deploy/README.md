# Install Courtside

Use the deployment archive attached to a Courtside release. It contains one immutable application
release, the lifecycle CLI and the four supported recipes. A source checkout is not an installation
input.

Verify the archive before unpacking it:

```sh
gh attestation verify courtside-deployment-<version>.zip --repo jegr78/courtside \
  --signer-workflow jegr78/courtside/.github/workflows/release.yml \
  --source-ref refs/tags/v<version>
shasum -a 256 -c courtside-deployment-<version>.zip.sha256
```

Docker with Compose 2.33.1 or newer is required. Courtside does not install host packages, change
DNS or firewall rules, upload diagnostics or enable scheduled jobs.

## Choose a recipe

| Your installation | Recipe | Guide |
| --- | --- | --- |
| One host, bundled PostgreSQL and an external SMTP relay | `standard` | [Standard](guides/standard.md) |
| One host, bundled PostgreSQL and self-hosted Stalwart mail | `full-self-hosted` | [Full self-hosted](guides/full-self-hosted.md) |
| An existing HTTPS ingress, PostgreSQL 17 and SMTP service | `existing-infrastructure` | [Existing infrastructure](guides/existing-infrastructure.md) |
| Tailscale Funnel, bundled PostgreSQL and an external SMTP relay | `funnel` | [Funnel](guides/funnel.md) |

Every recipe routes browser traffic through the Courtside-managed Caddy policy. The application
port is never published. The generated [recipe commands](guides/generated-recipes.md) come from the
same recipe files that the CLI reads.

## Install

Create a private installation directory, then start the launcher from the extracted archive:

```sh
sudo install -d -m 0700 -o "$USER" /srv/courtside
./courtside --directory /srv/courtside init
```

`init` validates the answers, prints the plan and asks for an exact confirmation before it writes
anything. It separates read-only releases from mutable configuration, secrets and backups. For an
unattended install, use the answer-file example in the selected recipe guide and pass secrets only
through the process environment.

After installation, always use the installed launcher:

```sh
/srv/courtside/current/courtside doctor
/srv/courtside/current/courtside up
/srv/courtside/current/courtside status
```

## Operate and harden

- [Operations handbook](guides/operations.md) covers bootstrap completion, diagnosis, backup,
  restore checks, updates, adoption, rotation and removal.
- [Stalwart guide](guides/stalwart.md) covers the self-hosted mail plan, DNS, certificates and
  delivery checks.
- [Optional hardening](guides/hardening.md) covers separate database identities and verified TLS.
- [Container contract](container-contract.md) is the platform-neutral contract for operators who do
  not use these Compose recipes.

The club owns its host, external services, credentials, backups and availability. Courtside checks
the software-controlled part of the selected recipe. Public DNS, routing, certificate issuance,
mail reputation and third-party delivery remain operator-owned conditions.
