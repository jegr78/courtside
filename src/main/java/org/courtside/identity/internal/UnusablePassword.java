package org.courtside.identity.internal;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.UUID;

// Stands in for an account that has none, so the refusal costs the same as any other and no caller
// can measure which accounts have never been issued a credential.
@Component
class UnusablePassword {

    private final String hash;

    UnusablePassword(PasswordEncoder encoder) {
        this.hash = encoder.encode(UUID.randomUUID().toString());
    }

    String hash() {
        return hash;
    }
}
