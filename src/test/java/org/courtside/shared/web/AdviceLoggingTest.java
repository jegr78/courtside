package org.courtside.shared.web;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.AbstractIntegrationTest;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.core.MethodParameter;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.util.ClassUtils;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

class AdviceLoggingTest extends AbstractIntegrationTest {

    private static final String OWNED_PACKAGE_PREFIX = "org.courtside";

    private static final ProblemType NOT_FOUND = new ProblemType(
            "test-failure-not-found", HttpStatus.NOT_FOUND, "Test failure", "Nothing found");

    private static final ProblemType SERVER_ERROR = new ProblemType(
            "test-failure-server-error", HttpStatus.INTERNAL_SERVER_ERROR, "Test failure", "Something broke");

    @Autowired
    private ApplicationContext context;

    private final ListAppender<ILoggingEvent> domainAppender = new ListAppender<>();
    private final ListAppender<ILoggingEvent> sharedAppender = new ListAppender<>();
    private Logger domainLogger;
    private Logger sharedLogger;
    private Level domainLoggerOriginalLevel;
    private Level sharedLoggerOriginalLevel;

    @BeforeEach
    void attachAppenders() {
        domainLogger = (Logger) LoggerFactory.getLogger(DomainFailureHandler.class);
        domainLoggerOriginalLevel = domainLogger.getLevel();
        domainLogger.setLevel(Level.DEBUG);
        domainAppender.start();
        domainLogger.addAppender(domainAppender);

        sharedLogger = (Logger) LoggerFactory.getLogger(SharedExceptionHandler.class);
        sharedLoggerOriginalLevel = sharedLogger.getLevel();
        sharedLogger.setLevel(Level.DEBUG);
        sharedAppender.start();
        sharedLogger.addAppender(sharedAppender);
    }

    @AfterEach
    void detachAppenders() {
        domainLogger.detachAppender(domainAppender);
        domainLogger.setLevel(domainLoggerOriginalLevel);
        sharedLogger.detachAppender(sharedAppender);
        sharedLogger.setLevel(sharedLoggerOriginalLevel);
    }

    @Test
    void givenA4xxDomainFailure_whenItIsAnswered_thenItIsLoggedAtDebugWithItsMessage() {
        // given
        UUID bookingId = UUID.fromString("00000000-0000-0000-0000-0000000000aa");
        DomainFailure failure = new NotFoundFailure("No booking with id " + bookingId);

        // when
        new DomainFailureHandler().handleDomainFailure(failure);

        // then
        assertThat(domainAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.DEBUG);
            assertThat(event.getFormattedMessage()).contains(bookingId.toString());
            assertThat(event.getThrowableProxy()).isNull();
        });
    }

    @Test
    void givenA5xxDomainFailure_whenItIsAnswered_thenItIsLoggedAtWarnWithItsExceptionAttached() {
        // given
        DomainFailure failure = new ServerErrorFailure("Something went wrong");

        // when
        new DomainFailureHandler().handleDomainFailure(failure);

        // then
        assertThat(domainAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.WARN);
            assertThat(event.getThrowableProxy()).isNotNull();
        });
    }

    @Test
    void givenADatabaseMessageNamingAMember_whenItIsAnswered_thenOnlyTheStatusAndExceptionAreLogged() {
        // given
        DataIntegrityViolationException exception = new DataIntegrityViolationException(
                "duplicate key value violates unique constraint \"account_username_key\"\n"
                        + "  Detail: Key (username)=(doe.jane) already exists.");

        // when
        new SharedExceptionHandler().handleRejectedByTheDatabase(exception);

        // then
        assertThat(sharedAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.DEBUG);
            assertThat(event.getFormattedMessage())
                    .contains("400 BAD_REQUEST", "DataIntegrityViolationException")
                    .doesNotContain("doe.jane");
            assertThat(event.getThrowableProxy()).isNull();
        });
    }

    @Test
    void givenAPasswordRejectedByValidation_whenItIsAnswered_thenTheFieldIsLoggedButNotItsValue()
            throws NoSuchMethodException {
        // given
        String rejectedPassword = "hunter2";
        MethodArgumentNotValidException exception = rejectionOf("password", rejectedPassword);

        // when
        new SharedExceptionHandler().handleValidationFailure(exception);

        // then
        assertThat(sharedAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getFormattedMessage())
                    .contains("password")
                    .doesNotContain(rejectedPassword);
            assertThat(event.getThrowableProxy()).isNull();
        });
    }

    @Test
    void givenTheRegisteredAdvices_whenTheirSourcesAreScanned_thenNoneCallsAPersonAccessor() {
        // given
        List<Path> advices = adviceSources();

        // when / then
        assertThat(advices).allSatisfy(advice -> assertThat(Files.readString(advice))
                .as("%s must log the userAccountId, never a person. Source text is all this scan "
                        + "reads: a value arriving inside a framework exception's message is beyond "
                        + "it, and the behavioural tests above cover that", advice)
                .doesNotContain("getEmail", "getDisplayName", "getFirstName", "getLastName"));
    }

    @Test
    void givenTheRegisteredAdvices_whenTheirSourcesAreScanned_thenEveryExceptionHandlerCallsLogAnswered()
            throws IOException {
        // given
        List<Path> advices = adviceSources();

        // when
        List<String> handlerBodies = new ArrayList<>();
        for (Path advice : advices) {
            String source = Files.readString(advice);
            Matcher handlers = Pattern.compile("@ExceptionHandler\\(").matcher(source);
            while (handlers.find()) {
                handlerBodies.add(handlerMethodBody(source, handlers.start()));
            }
        }

        // then
        assertThat(handlerBodies).isNotEmpty();
        assertThat(handlerBodies).allSatisfy(body -> assertThat(body)
                .as("every @ExceptionHandler method of a registered advice must call logAnswered so "
                        + "a new handler cannot ship silent")
                .contains("logAnswered("));
    }

    private List<Path> adviceSources() {
        List<Path> sources = context.getBeansWithAnnotation(ControllerAdvice.class).values().stream()
                .map(advice -> ClassUtils.getUserClass(advice).getName())
                .filter(name -> name.startsWith(OWNED_PACKAGE_PREFIX))
                .map(name -> Path.of("src/main/java", name.replace('.', '/') + ".java"))
                .sorted()
                .toList();
        assertThat(sources)
                .as("every advice this application registers must resolve to a source file, or a "
                        + "scan of those files covers less than it claims")
                .isNotEmpty()
                .allSatisfy(source -> assertThat(source).exists());
        return sources;
    }

    private static String handlerMethodBody(String source, int handlerStart) {
        int annotationOpen = source.indexOf('(', handlerStart);
        int annotationClose = matchingClose(source, annotationOpen, '(', ')');
        int bodyStart = source.indexOf('{', annotationClose);
        int bodyEnd = matchingClose(source, bodyStart, '{', '}');
        return source.substring(handlerStart, bodyEnd + 1);
    }

    private static int matchingClose(String source, int openIndex, char open, char close) {
        int depth = 0;
        for (int index = openIndex; index < source.length(); index++) {
            char character = source.charAt(index);
            depth += character == open ? 1 : character == close ? -1 : 0;
            if (depth == 0) {
                return index;
            }
        }
        return fail("Unbalanced %c%c from index %d in an advice source: this scan counts brackets "
                + "without understanding string literals, so one holding a bracket defeats it",
                open, close, openIndex);
    }

    private static MethodArgumentNotValidException rejectionOf(String field, String rejectedValue)
            throws NoSuchMethodException {
        BindingResult binding = new BeanPropertyBindingResult(new Object(), "request");
        binding.addError(new FieldError("request", field, rejectedValue, false,
                new String[]{"Size"}, null, "size must be between 12 and 128"));
        return new MethodArgumentNotValidException(
                new MethodParameter(AdviceLoggingTest.class
                        .getDeclaredMethod("changeInitialPassword", String.class), 0),
                binding);
    }

    private static void changeInitialPassword(String password) {
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

    private static final class ServerErrorFailure extends DomainFailure {
        ServerErrorFailure(String message) {
            super(message);
        }

        @Override
        public ProblemType problemType() {
            return SERVER_ERROR;
        }
    }
}
