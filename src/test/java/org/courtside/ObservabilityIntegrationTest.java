package org.courtside;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import org.hibernate.engine.jdbc.spi.SqlStatementLogger;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;

import java.time.Duration;

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

    @Test
    void givenASlowParameterizedQuery_whenHibernateReportsIt_thenTheQueryAndTraceAreCorrelated() {
        // given
        Logger logger = (Logger) LoggerFactory.getLogger("org.hibernate.SQL_SLOW");
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        Span span = tracer.nextSpan().name("slow-query-test").start();
        String query = "select * from booking where booked_by = ?";

        // when
        try (Tracer.SpanInScope ignored = tracer.withSpan(span)) {
            new SqlStatementLogger(false, false, false, 1)
                    .logSlowQuery(query, System.nanoTime() - Duration.ofMillis(10).toNanos(), null);
        } finally {
            span.end();
            logger.detachAppender(appender);
        }

        // then
        assertThat(appender.list).singleElement().satisfies(event -> {
            assertThat(event.getFormattedMessage()).contains(query);
            assertThat(event.getMDCPropertyMap().get("traceId")).isEqualTo(span.context().traceId());
            assertThat(event.getMDCPropertyMap().get("spanId")).isEqualTo(span.context().spanId());
        });
    }
}
