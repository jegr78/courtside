package org.courtside.shared;

import java.time.Instant;
import java.util.UUID;
import java.util.function.Consumer;

// The credential exists between the handover this is given and the account row it is written to,
// and nowhere else: what is stored is its hash, and a handover that throws stores nothing at all.
public interface CredentialIssuer {

    void issueFor(UUID accountId, Instant expiresAt, Consumer<IssuedCredential> handOver);
}
