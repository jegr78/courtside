package org.courtside.shared;

import java.time.Instant;

public record IssuedRegistrationCode(String recipientAddress, String recipientLocale,
                                     String code, Instant expiresAt) {
}
