package org.courtside.access;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class GrantInstructionTest {

    @Test
    void givenAnInstruction_whenItIsPrinted_thenTheCodeIsNotInTheText() {
        // given
        UUID grantId = UUID.fromString("7f500000-0000-0000-0000-000000000001");
        GrantInstruction instruction = new GrantInstruction(new GrantReference(grantId, null), "482915",
                Instant.parse("2026-05-12T08:45:00Z"), Instant.parse("2026-05-12T10:15:00Z"),
                Set.of(UUID.fromString("70300000-0000-0000-0000-000000000001")));

        // when
        String printed = instruction.toString();

        // then
        assertThat(printed)
                .as("an instruction reaches logs and exception messages, a door code must not")
                .doesNotContain("482915")
                .contains(grantId.toString(), "2026-05-12T08:45:00Z");
    }
}
