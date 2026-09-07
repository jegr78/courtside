package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.springframework.boot.session.autoconfigure.SessionProperties;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SessionLifetimeGuardTest {

    @Test
    void givenALifetimeShorterThanTheInactivityWindow_whenTheApplicationStarts_thenItRefuses() {
        // when / then — the shorter of the two decides, so the window a deployment configured would
        // never be reached and nothing would say so
        assertThatThrownBy(() -> guard(Duration.ofMinutes(30), Duration.ofMinutes(29)).afterPropertiesSet())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SESSION_ABSOLUTE_LIFETIME")
                .hasMessageContaining("COURTSIDE_SESSION_INACTIVITY_TIMEOUT");
    }

    @Test
    void givenTheTwoAreEqual_whenTheApplicationStarts_thenItStarts() {
        // when / then
        assertThatCode(() -> guard(Duration.ofMinutes(30), Duration.ofMinutes(30)).afterPropertiesSet())
                .doesNotThrowAnyException();
    }

    @Test
    void givenAnUnsetInactivityWindow_whenTheApplicationStarts_thenItRefusesRatherThanGuessOne() {
        // when / then — an unset timeout is Spring's own default, and this project states the value
        // it runs on rather than inheriting one that can change under it
        assertThatThrownBy(() -> guard(null, Duration.ofHours(24)).afterPropertiesSet())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SESSION_INACTIVITY_TIMEOUT");
    }

    // Spring Session reads a negative interval as one that never expires, so such a window is not a
    // strict setting but the inactivity bound switched off without saying so.
    @Test
    void givenAnInactivityWindowThatNeverExpires_whenTheApplicationStarts_thenItRefuses() {
        // when / then
        assertThatThrownBy(() -> guard(Duration.ofSeconds(-1), Duration.ofHours(24)).afterPropertiesSet())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SESSION_INACTIVITY_TIMEOUT");
    }

    @Test
    void givenAnInactivityWindowBelowTheFloor_whenTheApplicationStarts_thenItRefuses() {
        // when / then — the absolute bound is held to a minute at its shortest, and the window a
        // member actually notices is not held to less
        assertThatThrownBy(() -> guard(Duration.ofSeconds(30), Duration.ofHours(24)).afterPropertiesSet())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("COURTSIDE_SESSION_INACTIVITY_TIMEOUT");
    }

    private SessionLifetimeGuard guard(Duration inactivity, Duration absolute) {
        SessionProperties properties = new SessionProperties();
        properties.setTimeout(inactivity);
        return new SessionLifetimeGuard(properties,
                new CourtsideSessionProperties(absolute, 5, Duration.ofMinutes(5)));
    }
}
