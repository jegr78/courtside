package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectorTextTest {

    @Test
    void givenAUrlWithCredentialsAndAQuery_whenSanitized_thenOnlySchemeHostAndPathRemain() {
        // when
        String sanitized = ConnectorText.sanitized("GET https://user:secret@miniserver.example.org/x?token=y failed",
                null);

        // then
        assertThat(sanitized).isEqualTo("GET https://miniserver.example.org/x failed");
    }
}
