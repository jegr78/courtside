package org.courtside.shared;

import java.time.Instant;

public record IssuedCredential(String recipientAddress, String recipientFirstName,
                               String recipientLocale, String username,
                               String credential, Instant expiresAt) {
}
