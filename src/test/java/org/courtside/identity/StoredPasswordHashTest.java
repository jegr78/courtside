package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;

class StoredPasswordHashTest extends AbstractIntegrationTest {

    private static final String KNOWN_PASSWORD = "correct-horse-battery-staple";

    private static final String WRITTEN_BY_AN_EARLIER_RELEASE =
            "$argon2id$v=19$m=19456,t=2,p=1$h/4DxwqthuPIcDDfGwqGGw"
                    + "$tFinNXb4sLmlHdKoAg4sP40d7gqmw/AS4Q5vBIgScHE";

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Test
    void givenAHashWrittenByAnEarlierRelease_whenItIsVerified_thenTheMemberCanStillSignIn() {
        // then
        assertThat(passwordEncoder.matches(KNOWN_PASSWORD, WRITTEN_BY_AN_EARLIER_RELEASE))
                .as("an upgrade must not invalidate the passwords a club's members already have")
                .isTrue();
    }

    @Test
    void givenAHashWrittenByAnEarlierRelease_whenTheWrongPasswordIsOffered_thenItIsRefused() {
        // then
        assertThat(passwordEncoder.matches("not-the-password", WRITTEN_BY_AN_EARLIER_RELEASE))
                .isFalse();
    }
}
