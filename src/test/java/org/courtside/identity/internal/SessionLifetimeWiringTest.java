package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

class SessionLifetimeWiringTest extends AbstractIntegrationTest {

    @Autowired
    private ApplicationContext context;

    // The guard's own tests build it, and a context runner registers it by hand. Neither shows that
    // the component scan picks it up, which is what makes a contradictory deployment refuse to start.
    @Test
    void whenTheApplicationStarts_thenTheLifetimeGuardIsOneOfItsBeans() {
        // when / then
        assertThat(context.getBeanNamesForType(SessionLifetimeGuard.class)).isNotEmpty();
    }

    @Test
    void whenTheApplicationStarts_thenTheSweepThatOutlivesTheInactivityWindowIsOneOfItsBeans() {
        // when / then
        assertThat(context.getBeanNamesForType(AgedSessionSweep.class)).isNotEmpty();
    }
}
