package org.courtside;

import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.handler.AbstractUrlHandlerMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfoHandlerMapping;

import java.time.Duration;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class RequestMetricUriTest extends AbstractIntegrationTest {

    // The values the server request convention reports when no route template matched.
    private static final Set<String> UNMATCHED_OUTCOMES = Set.of("REDIRECTION", "NOT_FOUND", "root", "UNKNOWN");

    @Autowired
    private ApplicationContext context;

    @Autowired
    private MeterRegistry meters;

    @Test
    void givenEveryRouteTheApplicationServes_whenEachAnswersARequest_thenEachKeepsItsOwnRequestTimer() {
        // given
        Set<String> uris = new TreeSet<>(UNMATCHED_OUTCOMES);
        context.getBeansOfType(HandlerMapping.class).values().forEach(mapping -> uris.addAll(routesOf(mapping)));
        assertThat(uris).as("the API alone declares more routes than the default limit of 100").hasSizeGreaterThan(100);

        // when
        uris.forEach(uri -> meters.timer("http.server.requests", "uri", uri).record(Duration.ofMillis(1)));

        // then
        Set<String> timed = meters.find("http.server.requests").timers().stream()
                .map(timer -> timer.getId().getTag("uri"))
                .collect(Collectors.toSet());
        assertThat(timed).as("every served route keeps its own request timer").containsAll(uris);
    }

    private static Set<String> routesOf(HandlerMapping mapping) {
        if (mapping instanceof RequestMappingInfoHandlerMapping methods) {
            return methods.getHandlerMethods().keySet().stream()
                    .flatMap(info -> info.getPatternValues().stream())
                    .collect(Collectors.toSet());
        }
        if (mapping instanceof AbstractUrlHandlerMapping urls) {
            return urls.getHandlerMap().keySet();
        }
        return Set.of();
    }
}
