package org.courtside.shared;

import java.util.UUID;

// The code exists between this call and the message that carries it, and nowhere else: what is
// stored is its fingerprint, and what is returned is handed straight to whoever sends it.
public interface PasswordResetCodeIssuer {

    IssuedResetCode issueFor(UUID accountId);
}
