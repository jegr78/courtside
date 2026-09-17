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
