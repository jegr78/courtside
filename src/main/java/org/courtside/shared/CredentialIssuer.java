package org.courtside.shared;

import java.time.Instant;
import java.util.UUID;

// The credential exists between this call and the message that carries it, and nowhere else: what
// is stored is its hash, and what is returned is handed straight to whoever sends it.
public interface CredentialIssuer {

    IssuedCredential issueFor(UUID accountId, Instant expiresAt);
}
