# Standard recipe

Choose `standard` for one Linux host with the bundled PostgreSQL database, Courtside Caddy on ports
80 and 443, and an external SMTP relay. DNS must already point the club hostname at the host, and
the relay must accept the credentials or source address you configure.

## Answer file

Create `answers.conf` with decisions only:

```ini
schema=1
recipe=standard
project=example-club
domain=courts.example.org
bootstrap_username=admin
bootstrap_display_name=Jane Doe
source_url=https://github.com/example/courtside
mail_domain=courts.example.org
mail_reply_to=board@example.org
mail_relay_host=smtp.example.org
mail_relay_username=courts@example.org
recovery_material=included
```

Pass the relay password in the process environment and initialize the private target:

```sh
./courtside --directory /srv/courtside init --answers answers.conf --yes
/srv/courtside/current/courtside doctor
/srv/courtside/current/courtside up
```

The command expects `COURTSIDE_MAIL_PASSWORD` in its environment and never writes it to the answer
file.

The bundled database password and one-time bootstrap password are generated into private files.
Retrieve the bootstrap password from the path printed by `init`, sign in, replace it, create a
backup and run `finalize-bootstrap --yes`.

## What to verify

`doctor --json` distinguishes software failures from public DNS, certificate and relay conditions.
Confirm that Caddy obtained a trusted certificate, the application is healthy, mail reaches a
controlled recipient and a backup passes `restore-check`. The [operations handbook](operations.md)
has the full command sequence and recovery rules.
