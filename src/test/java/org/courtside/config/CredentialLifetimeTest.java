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
                .hasMessageContaining("1 to 8760");
    }

    @Test
    void whenAskingForALifetimeBeyondAYear_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> new CredentialLifetime(8761))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void givenTheRangeTheSchemaAllows_whenCheckingIt_thenTheEndsAreInside() {
        // when / then
        assertThat(CredentialLifetime.isValid(1)).isTrue();
        assertThat(CredentialLifetime.isValid(8760)).isTrue();
        assertThat(CredentialLifetime.isValid(0)).isFalse();
        assertThat(CredentialLifetime.isValid(8761)).isFalse();
    }
}
