package org.courtside.access.internal;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DemandTest {

    private static final Instant FROM = Instant.parse("2026-05-12T09:45:00Z");
    private static final Instant UNTIL = Instant.parse("2026-05-12T11:15:00Z");

    @Test
    void whenADemandEndsBeforeItStarts_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> new Demand(UNTIL, FROM, Set.of(UUID.randomUUID())))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("A demand's window ends after it starts");
    }

    @Test
    void whenADemandOpensNoAccessPointOrAMissingOne_thenItIsRefused() {
        // given
        Set<UUID> withAGap = new HashSet<>(Arrays.asList(UUID.randomUUID(), null));

        // when / then
        assertThatThrownBy(() -> new Demand(FROM, UNTIL, Set.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("A demand opens at least one access point");
        assertThatThrownBy(() -> new Demand(FROM, UNTIL, withAGap))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("A demand opens at least one access point");
    }
}
