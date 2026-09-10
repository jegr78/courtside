# The cryptographic inventory

`security/cryptographic-inventory.json` is the complete list of what this product encrypts, hashes,
signs and generates at random. It exists so that replacing an algorithm or a key is a decision
somebody makes rather than a change nobody notices, and `CryptographicInventoryTest` keeps it
complete: a cryptographic call in `src/main/java`, `frontend/src`, `tools`, the workflows or the
reference deployment that no entry names fails the build.

## What an entry holds

`purpose`, `algorithm` and, where this project chose them, `parameters`. Then `implementation`,
`strength`, `class`, `owner`, `storageBoundary`, `permittedUse`, `rotation`, `revocation`,
`recovery`, `retirement`, `evidence` and `locations`.

`parameters` records what **this project decided** — the Argon2id cost, how many bytes a generated
credential carries, a content-encryption algorithm the workflow names. It never records what the
platform moves underneath us: an image digest, a library version, a cipher suite the reverse proxy
picks. A dependency bump must not require an inventory edit, or the inventory becomes a changelog
nobody keeps current.

`implementation` names the maintained code that computes the primitive, from a closed list:
`java-runtime`, `bouncy-castle`, `spring-security`, `web-crypto`, `node-crypto`, `openssl`,
`sigstore`, `stalwart`, `caddy`, `postgresql-jdbc`. A name outside it fails the build, so adding an
implementation is a decision somebody makes rather than a spelling. The three this build can start
are exercised rather than believed: the JDK's digests and `SecureRandom` have to resolve to a
provider inside `java.base`, Bouncy Castle has to recompute the Argon2id hash the shipped encoder
writes, and Spring Security has to issue the CSRF token this project does not generate.

`strength` says who decides how strong the primitive is and what that rests on. `decidedBy` is
`repository` or the party that decides instead, and `basis` says in prose what the number or the
boundary means.

Where this repository decides, the entry states `bits`, and unless it is an identifier they have to
reach 128. The number is not
taken on trust: where a literal in the code determines it — the bytes a generator draws, the
truncation a digest is cut to, the modulus a key pair is generated with — the test reads that
literal and recomputes. Raising or lowering the literal without moving the entry fails the build,
and so does the reverse.

Two bits conventions travel with `basis`, because one number cannot mean both. For a random value it
is the entropy drawn. For a hash it is the property the use depends on: collision resistance is half
the output, second-preimage resistance is the output itself, and the basis says which of the two the
entry is claiming.

Where somebody else decides, the entry states no bits at all. An operator negotiates a cipher suite,
Sigstore issues a keyless signing key, Stalwart generates the DKIM keys and Spring Security draws
the CSRF token, and a number written here would be a claim about somebody else's build. The basis
names them and says what is known.

`class` `identifier` is the one class the 128-bit minimum does not reach, because an identifier
answers to uniqueness rather than to secrecy. Its entries still state their bits and still say what
the bits buy. Where a literal in the code determines those bits, moving an entry into that class to
escape the minimum changes nothing, because the recomputation still reads what the code draws.
Where no literal does, the class is what a reader has to weigh, and moving one is a change to the
entry that the diff shows.

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
- `transport` — protects a connection, or records what one guarantees when that is less than
  protection. Public TLS and the mail relay are encrypted; the connection to PostgreSQL is
  encrypted and verified only when an operator requires it, as is the reverse proxy's connection to
  the application. Each of those entries says which value of its mode means which rather than
  claiming the strongest one.
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
in-memory counter rebuilds itself. No entry here now carries a private key this project must keep:
the one that did, the security-evidence envelope, was withdrawn once it emerged that its key had
never been created and its envelopes could never be opened.

## What this file is not

Neither this file nor the JSON holds key material, a fingerprint or anything from which material
could be derived, and a test refuses both if either looks like it does. They record where material
lives and who holds it.

It is also not a complete list of every secret an instance handles, only of the ones this project
generates or configures. A value the framework produces — the CSRF token — has an entry that says
what it is and who owns its lifecycle, but no parameters, because this project does not choose
them. The session identifier used to be one of those and no longer is: this project draws and
formats it, so its entry records the parameters like any other.
