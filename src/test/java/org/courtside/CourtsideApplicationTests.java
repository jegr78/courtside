package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.ApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

class CourtsideApplicationTests extends AbstractIntegrationTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void whenApplicationStarts_thenContextLoads() {
    }

    // What a web server serves is decided by a customizer, and a configuration the application does
    // not pick up would leave the transport to Spring's defaults without failing anything.
    @Test
    void whenApplicationStarts_thenItCarriesItsOwnTransportCustomizer() {
        // when / then
        assertThat(context.getBeansOfType(WebServerFactoryCustomizer.class).values())
                .anySatisfy(customizer -> assertThat(customizer.getClass().getName())
                        .startsWith("org.courtside.shared.ServerTlsConfiguration"));
    }
}
