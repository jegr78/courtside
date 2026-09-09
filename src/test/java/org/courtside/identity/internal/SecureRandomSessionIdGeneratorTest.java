package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SecureRandomSessionIdGeneratorTest {

    private static final int SESSION_ID_COLUMN_WIDTH = 36;

    private final SecureRandomSessionIdGenerator generator = new SecureRandomSessionIdGenerator();

    @Test
    void whenTheGeneratorIsAsked_thenItDrawsMoreMaterialThanTheControlRequires() {
        // when / then
        assertThat(SecureRandomSessionIdGenerator.IDENTIFIER_BYTES * 8)
                .as("ASVS v5.0.0-7.2.3 asks for 128 bits; UUID v4 carries 122 after its version"
                        + " and variant bits, which is the shortfall this generator replaces")
                .isGreaterThanOrEqualTo(128);
    }

    @Test
    void whenAnIdentifierIsGenerated_thenItFillsTheStoredColumnExactly() {
        // when
        String identifier = generator.generate();

        // then
        assertThat(identifier)
                .as("spring_session.session_id is CHAR(36): a longer identifier is rejected by"
                        + " PostgreSQL and a shorter one is padded with spaces it never gets back")
                .hasSize(SESSION_ID_COLUMN_WIDTH)
                .matches("[A-Za-z0-9_-]+");
    }
}
