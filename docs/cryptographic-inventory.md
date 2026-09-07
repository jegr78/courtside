# The cryptographic inventory

`security/cryptographic-inventory.json` is the complete list of what this product encrypts, hashes,
signs and generates at random. It exists so that replacing an algorithm or a key is a decision
somebody makes rather than a change nobody notices, and `CryptographicInventoryTest` keeps it
complete: a cryptographic call in `src/main/java`, `frontend/src`, `tools`, the workflows or the
reference deployment that no entry names fails the build.

## What an entry holds

`purpose`, `algorithm` and, where this project chose them, `parameters`. Then `class`, `owner`,
`storageBoundary`, `permittedUse`, `rotation`, `revocation`, `recovery`, `retirement`, `evidence`
and `locations`.

`parameters` records what **this project decided** — the Argon2id cost, how many bytes a generated
credential carries, a content-encryption algorithm the workflow names. It never records what the
platform moves underneath us: an image digest, a library version, a cipher suite the reverse proxy
picks. A dependency bump must not require an inventory edit, or the inventory becomes a changelog
nobody keeps current.

`owner` is a role, never a person. Two exist: `club-operator` for anything an instance holds, and
`repository-maintainer` for anything this repository holds.

`evidence` names the test or record that proves the entry, and every file it names has to exist.

`detects` names the tokens the entry is responsible for. A file is covered only when some entry
both matches its path and claims the token found in it, so a glob written for content hashes does
not silently absorb a cipher that appears beside them.

`locations` are glob patterns rather than file lists, so a new file of a kind the inventory already
covers does not fail the build, while a cryptographic use in a place no entry describes does.

That leniency stops at keys. A digest or a random value may be matched by a pattern; a cipher, a
generated key pair or a signature has to be named by an entry file by file, so a new one cannot
arrive under a glob nobody re-read.

Documentation is not scanned — a paragraph about TLS is not a use of it — and neither is the
shipped common-password list, whose hundred thousand lines contain words like `cipher` that would
read as cryptography.

## What `class` separates

The distinction that matters most in this file is between cryptography that carries a security
guarantee and cryptography that does not:

- `credential-protection` — protects a secret. Argon2id, the issued credential, the unusable
  password.
- `confidentiality` — keeps content from a reader. The security-evidence envelope.
- `signing` — lets somebody else verify an origin. The release signature, DKIM.
- `transport` — protects a connection, or records that one is not protected. Public TLS and the
  mail relay are encrypted; the connection to PostgreSQL inside the deployment is not, and its
  entry says so rather than leaving it out.
- `integrity` — recognises one expected party or artefact and refuses anything else. Certificate
  pinning. Unlike a `content-hash`, a mismatch here stops the operation.
- `pseudonymisation` — replaces an identifier with a digest so a counter need not hold the
  original. The login-attempt subject.
- `content-hash` — names content so two things can be compared. A booking fingerprint, a logo's
  ETag, an artefact digest in the harness. **These protect nothing.** A `content-hash` entry is not
  evidence that content was not tampered with by a party who could write it, and no assessment may
  present it as such.
- `identifier` — a value that only has to be unique. An idempotency key, a scratch name in a test.

Reading a `content-hash` or an `identifier` as an integrity control is the mistake this
classification exists to prevent — and the reverse, filing a real control under `content-hash`
because it also computes a digest, is the same mistake from the other side. Certificate pinning
computes SHA-256 exactly as a cache tag does, and only one of the two refuses a connection.

## Replacing an algorithm or a key

The rule is that no replacement may quietly weaken what it replaces.

**A parameter within an algorithm** (raising the Argon2id cost, lengthening a generated credential)
takes effect for everything written afterwards, and the entry says how existing material catches
up. For passwords that is the re-encode on the next successful sign-in; for a generated credential
it is the next issue. Lowering a parameter is a downgrade and is treated as one: it needs the same
statement in `docs/design.md` §10 that raising it would.

**An algorithm** is replaced by writing under the successor while the predecessor stays verifiable,
never by a flag day. The inventory carries both entries during that period, and the predecessor's
`retirement` says what has to be true before it is removed.

**A key or certificate** is replaced by the owner the entry names, following its `rotation`. Where
Courtside neither issues nor holds the material — public TLS, the mail relay, DKIM — the entry says
so plainly instead of describing a procedure this product does not perform.

**Where nothing can be lost, the entry says that** rather than inventing a recovery procedure. A
keyless release signature has no private key; a `SecureRandom` credential has no key to recover; an
in-memory counter rebuilds itself. The one entry with real loss is the security-evidence envelope,
whose private key lives outside this repository: losing it makes sealed evidence unreadable, and
the decrypt canary in `.github/security-evidence-key.json` is what bounds how long that can go
unnoticed.

## What this file is not

Neither this file nor the JSON holds key material, a fingerprint or anything from which material
could be derived, and a test refuses both if either looks like it does. They record where material
lives and who holds it.

It is also not a complete list of every secret an instance handles, only of the ones this project
generates or configures. Values the framework produces — the session identifier, the CSRF token —
have entries that say what they are and who owns their lifecycle, but no parameters, because this
project does not choose them.
