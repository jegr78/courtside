package org.courtside.shared;

import java.time.Instant;

public record IssuedResetCode(String recipientAddress, String recipientFirstName,
                              String recipientLocale, String username,
                              String code, Instant expiresAt) {
}
