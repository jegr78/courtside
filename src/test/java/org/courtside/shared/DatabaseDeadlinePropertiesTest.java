package org.courtside.shared;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DatabaseDeadlinePropertiesTest {

    @Test
    void givenAStatementTimeoutLongerThanTheRequestDeadline_whenReadingTheConfiguration_thenTheInstanceRefusesToStart() {
        // when / then
        assertThatThrownBy(() -> new DatabaseDeadlineProperties(Duration.ofSeconds(40), Duration.ofSeconds(30),
                Duration.ofMinutes(2), Duration.ofMinutes(10)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PT40S")
                .hasMessageContaining("PT30S");
    }

    @Test
    void givenARequestDeadlineLongerThanTheReportDeadline_whenReadingTheConfiguration_thenTheInstanceRefusesToStart() {
        // when / then
        assertThatThrownBy(() -> new DatabaseDeadlineProperties(Duration.ofSeconds(15), Duration.ofMinutes(3),
                Duration.ofMinutes(2), Duration.ofMinutes(10)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PT3M")
                .hasMessageContaining("PT2M");
    }

    @Test
    void givenOrderedDeadlines_whenReadingTheConfiguration_thenTheyAreAccepted() {
        // when / then
        assertThatCode(() -> new DatabaseDeadlineProperties(Duration.ofSeconds(15), Duration.ofSeconds(30),
                Duration.ofMinutes(2), Duration.ofMinutes(10)))
                .doesNotThrowAnyException();
    }
}
