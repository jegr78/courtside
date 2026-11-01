# Stalwart operations

This guide applies only to `full-self-hosted`. Stalwart owns mail submission, queues and delivery;
Caddy owns the public certificate copied into Stalwart's private TLS volume.

## Initial plan

Start the installation through the Courtside launcher. Its setup profile renders an immutable plan,
applies the one-time bootstrap plan and then applies the repeatable base plan. The plan creates
separate administrator, sender and certificate-reload identities. Rerunning it must not reset those
credentials.

Use the administration UI only through an SSH tunnel to its loopback port. Never publish the
administration port. After configuration, run:

```sh
/srv/courtside/current/courtside mail-check
```

The check covers the local certificate, relay authentication, DNS records and a controlled SMTP
peer. Public reputation and third-party acceptance remain outside Courtside's control.

## Upgrading older mail stores

Stalwart 1.0 uses a different store format from 0.16. A fresh installation uses the new format
directly. An existing installation using the pinned 0.16.27 image can explicitly initialize new
stores when updating to a verified release using 1.0.x. This path serves development and test
installations that do not need to carry their mail state into the new server.

Only 0.16.27 is accepted as the source, and Courtside 0.3.0 is the release that ships it. Courtside
0.1.0 and 0.2.0 run Stalwart 0.16.24 and 0.16.26, and the 1.0 launcher refuses both. Update such an
installation to 0.3.0 with that release's own archive first, then follow this procedure.

Reinitialization does not copy messages, queued deliveries, manually created accounts or settings.
It retains the original configuration and data volumes and a complete pre-update recovery unit.
Courtside's database, bookings, persistent keys and Caddy certificate store remain in place.

Use the launcher from the verified target archive:

```sh
candidate=/srv/courtside/candidate/courtside-deployment-<version>
"$candidate/courtside" --directory /srv/courtside update-check --archive "$candidate" \
  --mail-store-transition reinitialize
"$candidate/courtside" --directory /srv/courtside update --archive "$candidate" \
  --mail-store-transition reinitialize --yes
```

The preview names the exact images, retained stores and target naming pattern. `--yes` without the
transition option never authorizes this operation. Unknown image identities, other incompatible
transitions, deployment overlays and local overrides are refused before backup or downtime.

The update stops application submission before its backup, allocates a separate store pair and
applies the shipped bootstrap and base plans with the existing managed credentials. It removes
temporary recovery access, verifies the certificate reloader and checks the sender's authentication
over verified STARTTLS before starting the updated application. Local readiness does not establish
public delivery. Read the new DKIM selector and public key through the loopback administration UI,
publish the required DNS records and run `mail-check`. Verify external delivery with a controlled
recipient after those records are available.

The launcher records `COURTSIDE_MAIL_CONFIG_VOLUME` and `COURTSIDE_MAIL_DATA_VOLUME` together in
the private `.env`. Backups, reconfiguration and later updates use that same pair. Installations
without these values retain their original project volume names. Do not edit one name independently
or point a 1.0 image at an old store.

### Interrupted transitions

An interrupted transition with a committed journal blocks ordinary lifecycle commands. An
interruption before journal publication leaves the original release selected; `up` can restart it.
While the journal still records preparation and the original release is selected, `backup`,
`restore-check`, `diagnose`, `doctor` and `status` keep working, and `status` reports
`mail_transition=preparing`. Every other command stays refused until one of two exits is taken.

To retry, rerun the same candidate's `update` command with the same archive and explicit transition
option. If the original release is still selected, the launcher restarts it and retains the
interrupted target before preparing a new attempt. If the target release is selected, it verifies
the recorded volume ownership and resumes activation of that same pair. A failed activation retains
the recovery unit. Do not switch the `current` symlink back after application schema migrations;
recover the complete earlier unit.

To stay on the original release, abandon the attempt:

```sh
"$candidate/courtside" --directory /srv/courtside update --mail-store-transition abandon --yes
```

Abandoning needs no archive. It restarts the original mail server, its certificate reloader and the
application, moves the
journal to `backups/mail-transition-<attempt>` and stops there. It retains the attempt's stores and
the recovery unit. Once the target release is selected, abandoning is refused:
finish the transition or restore the complete recovery unit.

Private journals and attempt logs live in `.courtside-mail-transition` while active and in
`backups/mail-transition-<attempt>` afterwards. They contain credentials and must not be published.
The associated original recovery unit is exempt from automatic retention while its journal remains.
Neither a retry nor normal backup pruning deletes the retained mail volumes.

`prune` lists every retained history with its store pair, whether that pair is `selected` or
`unused`, and the recovery unit it holds. It removes none of them. To reclaim an unused attempt,
check that `.env` does not name its stores, then remove them and the history yourself:

```sh
docker volume rm <project>_mail-config-stalwart1-<attempt> <project>_mail-data-stalwart1-<attempt>
rm -rf /srv/courtside/backups/mail-transition-<attempt>
```

Removing a history returns its recovery unit to normal `prune` retention. After a completed
transition the original `<project>_mail-config` and `<project>_mail-data` volumes also remain;
`docker volume ls --filter label=com.docker.compose.project=<project>` shows them. The pre-update
recovery unit holds a copy of both, so keep the volumes only as long as that unit is not enough.

### Preserving mail contents

If existing mail contents or manual settings must remain in the active server, reinitialization is
unsuitable. The [Stalwart migration guide](https://stalw.art/docs/migration/upgrade-0-16/quick-guide/)
describes a separate data-preserving migration with `stalwart-migrate`, new target stores and a
verified final copy after stopping 0.16. Courtside does not currently automate or certify that path.
Do not bypass the launcher by changing the installed release's image pin.

## DNS and delivery

Publish MX, SPF, DKIM and DMARC records for the configured mail domain. Forward and reverse DNS must
name the sending host when the club delivers directly. A provider may still block port 25 or reject
an unfamiliar IP. Use an upstream relay if the host cannot establish a reliable direct-delivery
identity.

Test with a controlled recipient first. A locally accepted message proves only that Stalwart queued
it; the test that matters is delivery to another system and a reply back to the configured address.

## Certificates and recovery

The certificate helper waits until Caddy has a certificate for the mail hostname, validates the
pair and publishes it atomically. The reload helper asks Stalwart to load only a validated pair.
Read the health state reported by `doctor` before rotating or renewing anything.

Backups include both `mail-config` and `mail-data`. If the administrator credential is lost, use the
documented recovery mode only from the host console, rotate the credential immediately and disable
recovery mode before restoring public service.
