package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.WarmUpStep;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@Order(50)
@RequiredArgsConstructor
class PasswordVerificationWarmUp implements WarmUpStep {

    static final int ROUND_BUDGET = 10;

    // Protects nothing: the hash lives in memory only and no account is read or touched.
    private static final String PROBE = "warm-up-password-verification";

    private final PasswordEncoder passwordEncoder;
    private String hash;

    @Override
    public String name() {
        return "password-verification";
    }

    // One Argon2id verification already loops long enough to compile its hash.
    @Override
    public int roundBudget() {
        return ROUND_BUDGET;
    }

    @Override
    public synchronized boolean run() {
        if (hash == null) {
            hash = passwordEncoder.encode(PROBE);
        }
        if (!passwordEncoder.matches(PROBE, hash)) {
            throw new IllegalStateException("The password encoder rejected a hash it had just produced");
        }
        return true;
    }
}
