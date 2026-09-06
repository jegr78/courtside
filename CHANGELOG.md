## Missing from the generated entries

release-please builds the sections above from commit messages, and its parser rejected two of them
outright — they appear nowhere in the release that contains them. Both landed before the first
release, and `tools/commit-message-parser.test.mjs` now fails a build rather than let a third one go
the same way.

- **feat: record the failure an error response answers for**
  ([#276](https://github.com/jegr78/courtside/pull/276)) — keeps rejected values out of the advice
  log, so a password, a PostgreSQL `Key (username)=(...)` detail or a raw Jackson value can no
  longer reach it.
- **fix: let a member book when the club serves Courtside without TLS**
  ([#319](https://github.com/jegr78/courtside/pull/319))
