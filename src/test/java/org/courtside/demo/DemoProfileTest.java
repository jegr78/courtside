package org.courtside.demo;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

class DemoProfileTest extends AbstractIntegrationTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void givenTheDemoProfileIsInactive_whenTheApplicationStarts_thenNoSeederExists() {
        // when
        String[] seeders = context.getBeanNamesForType(DemoDataSeeder.class);

        // then
        assertThat(seeders).isEmpty();
    }
}
