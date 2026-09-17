# Operating Courtside

This handbook helps you choose a deployment recipe and verify an installation. The English guides
inside the release archive are the technical reference. Download the archive from the release page
and verify its attestation and SHA-256 checksum before extracting it.

## Choose a recipe

| Situation | Recipe |
| --- | --- |
| One Linux host, bundled PostgreSQL and an external SMTP relay | `standard` |
| One Linux host with PostgreSQL and self-hosted Stalwart mail | `full-self-hosted` |
| Existing HTTPS ingress, PostgreSQL 17 and SMTP service | `existing-infrastructure` |
| Public access through Tailscale Funnel | `funnel` |

The [generated recipe commands](generated-operator-recipes.md) come from the same recipe files the
deployment CLI reads. Documentation and the rendered Compose model therefore cannot drift without
failing a repository check.

## Install

Create a private target directory and start the launcher from the extracted archive:

```sh
sudo install -d -m 0700 -o "$USER" /srv/courtside
./courtside --directory /srv/courtside init
```

`init` validates the answers, prints its plan and waits for confirmation. Do not put passwords in
an answer file. Pass them only in the process environment. Use the installed launcher afterwards:

```sh
/srv/courtside/current/courtside doctor
/srv/courtside/current/courtside up
/srv/courtside/current/courtside status
```

Sign in with the one-time bootstrap password and replace it immediately. Then create a recovery
unit, exercise it with `restore-check` and remove the bootstrap values with
`finalize-bootstrap --yes`.

## Backups and updates

```sh
/srv/courtside/current/courtside backup --retain 7
/srv/courtside/current/courtside restore-check --recovery <recovery directory>
/srv/courtside/current/courtside update --archive <new archive> --yes
```

An update creates a recovery unit first. It does not promise an automatic database downgrade after
a newer migration has run. Retain the previous release and regularly test recovery against an empty
PostgreSQL 17 target.

## Tailscale Funnel

The Funnel recipe publishes only the local Caddy listener:

```sh
tailscale funnel --bg https+insecure://127.0.0.1:8080
```

`--bg` keeps the service active after the shell session ends. Never point Funnel directly at the
application or management port. That would bypass Caddy's host, request-size, forwarding-header and
response-header policy and create a different API and management boundary.

## What Courtside can verify

`doctor --json` separates Courtside configuration failures from operator-owned conditions. Public
DNS, firewall and routing, certificate issuance, external databases, SMTP providers and mail
reputation belong to the operator. If Courtside cannot observe one of those conditions, it reports
`WARN` or `unknown`, never an automatic `PASS`.

Courtside does not install packages, change firewall or DNS rules, upload diagnostics or enable a
schedule. The systemd and cron examples in the archive remain inert until you review, copy and
enable them.
