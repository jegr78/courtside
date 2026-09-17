# Full self-hosted recipe

Choose `full-self-hosted` when the same Linux host runs PostgreSQL, Caddy and Stalwart. Courtside
uses Caddy for the web boundary and for the certificate Stalwart serves. Port 25 must be reachable
for direct delivery. An upstream relay can still carry outbound mail.

## Answer file

```ini
schema=1
recipe=full-self-hosted
project=example-club
domain=courts.example.org
bootstrap_username=admin
bootstrap_display_name=Jane Doe
source_url=https://github.com/example/courtside
mail_domain=courts.example.org
mail_reply_to=board@example.org
recovery_material=included
```

Initialize and start the installation:

```sh
./courtside --directory /srv/courtside init --answers answers.conf --yes
/srv/courtside/current/courtside doctor
/srv/courtside/current/courtside up
/srv/courtside/current/courtside mail-check
```

The launcher creates distinct Stalwart administration, sender, reload and setup credentials. Do
not copy any of them into the answer file. Follow the [Stalwart guide](stalwart.md) for DNS, initial
configuration, certificate handover and controlled delivery probes.

## Recovery boundary

A recovery unit includes the PostgreSQL dump and both Stalwart volumes. The launcher stops Stalwart
for one controlled interval so its configuration and message data agree. An interrupted mail backup
leaves a marker; the next managed command restarts Stalwart before doing other work. Always run a
restore check before treating a backup as usable.
