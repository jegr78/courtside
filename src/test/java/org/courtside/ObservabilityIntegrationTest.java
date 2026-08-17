package org.courtside;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = "management.tracing.sampling.probability=1.0")
class ObservabilityIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private Tracer tracer;

    @Autowired
    private Environment environment;

    @Test
    void givenTelemetryExportIsNotConfigured_whenStartingTheApplication_thenTracingRemainsLocal() {
        // when
        Span span = tracer.nextSpan().name("observability-test").start();

        // then
        try {
            assertThat(span.isNoop()).isFalse();
            assertThat(environment.getProperty("management.tracing.export.otlp.enabled", Boolean.class)).isFalse();
            assertThat(environment.getProperty("management.otlp.metrics.export.enabled", Boolean.class)).isFalse();
        } finally {
            span.end();
        }
    }

    @Test
    void givenAnActiveSpan_whenWritingALogEvent_thenTraceAndSpanIdentifiersAreAttached() {
        // given
        Logger logger = (Logger) LoggerFactory.getLogger(ObservabilityIntegrationTest.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        Span span = tracer.nextSpan().name("log-correlation-test").start();

        // when
        try (Tracer.SpanInScope ignored = tracer.withSpan(span)) {
            logger.info("Observability correlation test");
        } finally {
            span.end();
            logger.detachAppender(appender);
        }

        // then
        assertThat(appender.list).singleElement().satisfies(event -> {
            assertThat(event.getMDCPropertyMap().get("traceId")).isEqualTo(span.context().traceId());
            assertThat(event.getMDCPropertyMap().get("spanId")).isEqualTo(span.context().spanId());
        });
    }
}
