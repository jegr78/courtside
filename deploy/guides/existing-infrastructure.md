# Existing infrastructure recipe

Choose `existing-infrastructure` when an operator-owned HTTPS ingress, PostgreSQL 17 and SMTP relay
already exist. Courtside still runs Caddy on `127.0.0.1:8080`. The outer ingress must replace client
forwarding headers, set `X-Forwarded-Proto: https` and send the expected host.

## Answer file

```ini
schema=1
recipe=existing-infrastructure
project=example-club
domain=courts.example.org
bootstrap_username=admin
bootstrap_display_name=Jane Doe
source_url=https://github.com/example/courtside
mail_domain=courts.example.org
mail_reply_to=board@example.org
mail_relay_host=smtp.example.org
mail_relay_username=courts@example.org
database_url=jdbc:postgresql://database.example.org:5432/courtside
database_username=courtside
recovery_material=external-verified
```

Supply `COURTSIDE_DATABASE_PASSWORD` and `COURTSIDE_MAIL_PASSWORD` only to the initializing process:

```sh
./courtside --directory /srv/courtside init --answers answers.conf --yes
```

The database account must be able to run the selected migration model. Prefer the
`database-identities` and `database-tls` overlays described in [optional hardening](hardening.md).

## Operator-owned checks

`doctor` can validate the rendered configuration and the local Caddy boundary. It cannot certify
the external ingress, database service, public certificate or SMTP provider. An unavailable
external observation is `WARN` or `unknown`, not a software pass. Test the exact outer-ingress
headers and run a recovery-unit restore against an empty compatible PostgreSQL 17 target before
opening the instance to members.
