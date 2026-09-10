package org.courtside.identity.internal;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Base64;

// Stands in for an account that has none, so the refusal costs the same as any other and no caller
// can measure which accounts have never been issued a credential.
@Component
class UnusablePassword {

    private static final int PLAINTEXT_BYTES = 32;

    private final String hash;

    UnusablePassword(PasswordEncoder encoder) {
        byte[] plaintext = new byte[PLAINTEXT_BYTES];
        new SecureRandom().nextBytes(plaintext);
        this.hash = encoder.encode(Base64.getUrlEncoder().withoutPadding().encodeToString(plaintext));
    }

    String hash() {
        return hash;
    }
}
