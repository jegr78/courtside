package org.courtside.config;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CredentialLifetimeTest {

    @Test
    void givenAnHourCount_whenAskedHowLongItLasts_thenItIsThatManyHours() {
        // when / then
        assertThat(new CredentialLifetime(168).toDuration()).isEqualTo(Duration.ofHours(168));
    }

    @Test
    void whenAskingForALifetimeOfNoHours_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> new CredentialLifetime(0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("1 to 168");
    }

    @Test
    void whenAskingForALifetimeBeyondAWeek_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> new CredentialLifetime(169))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void givenTheRangeTheSchemaAllows_whenCheckingIt_thenTheEndsAreInside() {
        // when / then
        assertThat(CredentialLifetime.isValid(1)).isTrue();
        assertThat(CredentialLifetime.isValid(168)).isTrue();
        assertThat(CredentialLifetime.isValid(0)).isFalse();
        assertThat(CredentialLifetime.isValid(169)).isFalse();
    }
}
