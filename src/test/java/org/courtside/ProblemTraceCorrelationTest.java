package org.courtside;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.jayway.jsonpath.JsonPath;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "management.tracing.sampling.probability=0.0",
        classes = {CourtsideApplication.class, ProblemTraceCorrelationTest.DomainFailureEndpoint.class})
class ProblemTraceCorrelationTest extends AbstractIntegrationTest {

    private static final String INBOUND_TRACE_ID = "11111111111111111111111111111111";
    private static final String INBOUND_PARENT_SPAN_ID = "2222222222222222";

    @LocalServerPort
    private int port;

    @Test
    void givenAnUnsampledSharedProblem_whenReadingTheLog_thenTheReferenceIdentifiesTheServerSpan()
            throws Exception {
        // given / when
        CorrelatedProblem correlated = requestProblem(
                "/api/public/unknown", "org.courtside.shared.web.SharedExceptionHandler", "Answering 404");

        // then
        assertCorrelation(correlated);
    }

    @Test
    void givenAnUnsampledDomainProblem_whenReadingTheLog_thenTheReferenceIdentifiesTheServerSpan()
            throws Exception {
        // given / when
        CorrelatedProblem correlated = requestProblem(
                "/api/public/test-domain-failure", "org.courtside.shared.web.DomainFailureHandler", "Answering 409");

        // then
        assertCorrelation(correlated);
    }

    private CorrelatedProblem requestProblem(String path, String loggerName, String answer) throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(loggerName);
        Level previousLevel = logger.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.setLevel(Level.DEBUG);
        logger.addAppender(appender);
        try {
            HttpResponse<String> response = HttpClient.newHttpClient().send(
                    HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                            .header("Accept", "application/problem+json")
                            .header("traceparent", "00-" + INBOUND_TRACE_ID + "-" + INBOUND_PARENT_SPAN_ID + "-00")
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            ILoggingEvent event = appender.list.stream()
                    .filter(candidate -> candidate.getFormattedMessage().contains(answer))
                    .findFirst()
                    .orElseThrow();
            return new CorrelatedProblem(response.body(), event);
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(previousLevel);
            appender.stop();
        }
    }

    private static void assertCorrelation(CorrelatedProblem correlated) {
        String traceId = JsonPath.read(correlated.body(), "$.traceId");
        String spanId = JsonPath.read(correlated.body(), "$.spanId");
        assertThat(traceId).isEqualTo(INBOUND_TRACE_ID);
        assertThat(spanId).matches("[0-9a-f]{16}").isNotEqualTo(INBOUND_PARENT_SPAN_ID);
        assertThat(correlated.event().getMDCPropertyMap())
                .containsEntry("traceId", traceId)
                .containsEntry("spanId", spanId);
    }

    @RestController
    static class DomainFailureEndpoint {

        private static final ProblemType TEST_CONFLICT = new ProblemType(
                "test-conflict", HttpStatus.CONFLICT, "Test conflict", "The test request conflicts");

        @GetMapping("/api/public/test-domain-failure")
        void fail() {
            throw new TestConflictFailure();
        }
    }

    private static final class TestConflictFailure extends DomainFailure {

        private TestConflictFailure() {
            super("Test conflict");
        }

        @Override
        public ProblemType problemType() {
            return DomainFailureEndpoint.TEST_CONFLICT;
        }
    }

    private record CorrelatedProblem(String body, ILoggingEvent event) {
    }
}
