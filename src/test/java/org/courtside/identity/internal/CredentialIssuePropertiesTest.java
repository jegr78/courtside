package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CredentialIssuePropertiesTest {

    @Test
    void givenARetentionShorterThanTheWindow_whenReadingTheConfiguration_thenTheInstanceRefusesToStart() {
        // when / then — the row would be deleted mid-window and the count would start over
        assertThatThrownBy(() -> new CredentialIssueProperties(
                5, Duration.ofHours(1), Duration.ofMinutes(30)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("PT30M")
                .hasMessageContaining("PT1H");
    }

    @Test
    void givenARetentionThatOutlastsTheWindow_whenReadingTheConfiguration_thenItIsAccepted() {
        // when / then
        assertThatCode(() -> new CredentialIssueProperties(5, Duration.ofHours(1), Duration.ofHours(1)))
                .doesNotThrowAnyException();
    }
}
