package org.courtside.shared.web;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class AdviceLoggingTest {

    private static final ProblemType NOT_FOUND = new ProblemType(
            "test-failure-not-found", HttpStatus.NOT_FOUND, "Test failure", "Nothing found");

    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private Logger logger;

    @BeforeEach
    void attachAppender() {
        logger = (Logger) LoggerFactory.getLogger(DomainFailureHandler.class);
        logger.setLevel(Level.DEBUG);
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void detachAppender() {
        logger.detachAppender(appender);
    }

    @Test
    void givenADomainFailure_whenItIsAnswered_thenItIsLoggedAtDebugWithItsMessage() {
        // given
        UUID bookingId = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
        DomainFailure failure = new NotFoundFailure("No booking with id " + bookingId);

        // when
        new DomainFailureHandler().handleDomainFailure(failure);

        // then
        assertThat(appender.list).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.DEBUG);
            assertThat(event.getFormattedMessage()).contains(bookingId.toString());
        });
    }

    @Test
    void whenAnAdviceLogs_thenItNeverNamesAPersonOrTheirAddress() throws IOException {
        // given
        List<Path> advices = List.of(
                Path.of("src/main/java/org/courtside/shared/web/DomainFailureHandler.java"),
                Path.of("src/main/java/org/courtside/shared/web/SharedExceptionHandler.java"));

        // then
        assertThat(advices).allSatisfy(advice -> assertThat(Files.readString(advice))
                .as("%s must log the userAccountId, never a person", advice)
                .doesNotContain("getEmail", "getDisplayName", "getFirstName", "getLastName"));
    }

    private static final class NotFoundFailure extends DomainFailure {
        NotFoundFailure(String message) {
            super(message);
        }

        @Override
        public ProblemType problemType() {
            return NOT_FOUND;
        }
    }
}
