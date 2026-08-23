package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;

class UnusablePasswordTest {

    private static final PasswordEncoder ENCODER = new Argon2PasswordEncoder(16, 32, 1, 19456, 2);
    private static final String A_REAL_HASH = ENCODER.encode("correct-horse-battery-staple");

    @Test
    void whenStandingInForAnAccountWithoutOne_thenNothingMatchesIt() {
        // given
        String hash = new UnusablePassword(ENCODER).hash();

        // when / then
        assertThat(ENCODER.matches("", hash)).isFalse();
        assertThat(ENCODER.matches("correct-horse-battery-staple", hash)).isFalse();
    }

    @Test
    void whenTwoInstancesStandIn_thenTheyDoNotShareAValue() {
        // when / then — a value shared across instances is a value somebody could learn once
        assertThat(new UnusablePassword(ENCODER).hash())
                .isNotEqualTo(new UnusablePassword(ENCODER).hash());
    }

    @Test
    void whenVerifyingAgainstIt_thenItCostsWhatVerifyingARealPasswordCosts() {
        // given
        String standIn = new UnusablePassword(ENCODER).hash();
        ENCODER.matches("warmup", standIn);
        ENCODER.matches("warmup", A_REAL_HASH);

        // when
        long againstReal = elapsedVerifying(A_REAL_HASH);
        long againstStandIn = elapsedVerifying(standIn);

        // then — a cheap stand-in would return in a fraction of the time and say which accounts
        // have never been issued a credential; the two are compared in one run, not to a deadline
        assertThat(againstStandIn).isGreaterThan(againstReal / 2);
    }

    private static long elapsedVerifying(String hash) {
        long start = System.nanoTime();
        for (int attempt = 0; attempt < 5; attempt++) {
            ENCODER.matches("a-wrong-password", hash);
        }
        return System.nanoTime() - start;
    }
}
