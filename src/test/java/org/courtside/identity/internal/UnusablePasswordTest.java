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

        // when / then — Argon2 charges what its parameters say, so equal parameters are equal work.
        // A stopwatch here would assert the machine the suite happens to run on.
        assertThat(costOf(standIn)).isEqualTo(costOf(A_REAL_HASH));
    }

    // $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
    private static String costOf(String hash) {
        String[] fields = hash.split("\\$");
        return String.join("$", fields[1], fields[2], fields[3]);
    }
}
