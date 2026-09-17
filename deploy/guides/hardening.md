# Optional deployment hardening

The four recipes work without these overlays. Add an overlay only after the base recipe passes
`doctor`, because each overlay introduces certificate or credential material that can fail closed.

## Separate database identities

`database-identities` separates ownership, migration and runtime privileges. The application keeps
only the runtime password; a short-lived migration service applies Flyway changes. Store each
password in its own mode-0600 file and select the overlay through the answer file.

For an external database, create the owner role and database outside Courtside, then give the setup
service the owner credential for the bounded transition. The launcher refuses adoption when an
external password cannot be proven separately.

## Verified database TLS

`database-tls` makes the client require a trusted PostgreSQL certificate. With bundled PostgreSQL,
also select `database-tls-local` so the database serves the matching certificate. Provide a private
authority and a server certificate whose name matches the hostname in the JDBC URL. An incomplete
pair stops the deployment rather than falling back to an unverified connection.

## Application TLS behind Caddy

`app-tls` encrypts and verifies the Caddy-to-application hop. Mount the application authority,
certificate and private key through the documented paths. Caddy verifies the name it dials. This
overlay does not replace public TLS at the ingress.

## Custom images

`custom-image` accepts another repository, SHA-256 digest and source URL. It marks the rendered
service as custom and removes the official release trust claim. Verify that image against its own
publisher and provenance. A tag alone is never accepted.
