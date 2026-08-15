package org.courtside.shared.web;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.core.read.ListAppender;
import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.MethodParameter;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
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
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;
import static org.assertj.core.api.InstanceOfAssertFactories.STRING;

class AdviceLoggingTest {

    private static final String OWNED_PACKAGE_PREFIX = "org.courtside";

    private static final String EXCEPTION_HANDLER_ANNOTATION = "@ExceptionHandler";

    // Spring infers the exception type from the parameter, so the annotation may carry no attribute.
    private static final Pattern EXCEPTION_HANDLER =
            Pattern.compile(Pattern.quote(EXCEPTION_HANDLER_ANNOTATION) + "(?![A-Za-z0-9_$])");

    private static final ProblemType NOT_FOUND = new ProblemType(
            "test-failure-not-found", HttpStatus.NOT_FOUND, "Test failure", "Nothing found");

    private static final ProblemType CONFLICT = new ProblemType(
            "test-failure-conflict", HttpStatus.CONFLICT, "Test failure", "Already taken");

    private static final ProblemType SERVER_ERROR = new ProblemType(
            "test-failure-server-error", HttpStatus.INTERNAL_SERVER_ERROR, "Test failure", "Something broke");

    private static final String DUPLICATE_USERNAME =
            "duplicate key value violates unique constraint \"account_username_key\"\n"
                    + "  Detail: Key (username)=(doe.jane) already exists.";

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
    void givenACodedDomainFailure_whenItIsAnswered_thenItsStatusTypeAndViolationAreLoggedAtDebug() {
        // given
        DomainFailure failure = new ConflictFailure("card.label.taken", Map.of("field", "cardLabel"));

        // when
        new DomainFailureHandler().handleDomainFailure(failure);

        // then
        assertThat(domainAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.DEBUG);
            assertThat(event.getFormattedMessage())
                    .contains("409 CONFLICT", "urn:courtside:error:test-failure-conflict",
                            "card.label.taken", "cardLabel");
            assertThat(event.getThrowableProxy()).isNull();
        });
    }

    @Test
    void givenAFailureWhoseMessageNamesTheRejectedValue_whenItIsAnswered_thenTheValueIsNotLogged() {
        // given
        String rejectedLabel = "Guest training";
        DomainFailure failure = new NotFoundFailure("Card label %s is already taken".formatted(rejectedLabel));

        // when
        new DomainFailureHandler().handleDomainFailure(failure);

        // then
        assertThat(domainAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getFormattedMessage())
                    .as("a domain failure's message is free text a throw site may build from the "
                            + "value the request submitted, and the response withholds it")
                    .contains("404 NOT_FOUND", "urn:courtside:error:test-failure-not-found")
                    .doesNotContain(rejectedLabel);
            assertThat(event.getThrowableProxy()).isNull();
        });
    }

    @Test
    void givenA5xxFailureCausedByADatabaseError_whenItIsAnswered_thenTheWarnLineCarriesThatDetail() {
        // given
        DomainFailure failure = new ServerErrorFailure("Something went wrong",
                new DataIntegrityViolationException(DUPLICATE_USERNAME));

        // when
        new DomainFailureHandler().handleDomainFailure(failure);

        // then
        assertThat(domainAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.WARN);
            assertThat(causeChainOf(event))
                    .as("a 5xx is an incident and not an expected outcome, so its cause chain is "
                            + "logged whole. Whoever declares the first 5xx problem type accepts "
                            + "that a WARN line may then carry a database detail")
                    .contains("doe.jane");
        });
    }

    @Test
    void givenADatabaseMessageNamingAMember_whenItIsAnswered_thenOnlyTheStatusAndProblemTypeAreLogged() {
        // given
        DataIntegrityViolationException exception = new DataIntegrityViolationException(DUPLICATE_USERNAME);

        // when
        new SharedExceptionHandler().handleRejectedByTheDatabase(exception);

        // then
        assertThat(sharedAppender.list).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.DEBUG);
            assertThat(event.getFormattedMessage())
                    .contains("400 BAD_REQUEST", "urn:courtside:error:constraint-violation")
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
    void givenTheAdvicesOnTheClassPath_whenTheirSourcesAreScanned_thenNoneCallsAPersonAccessor() {
        // given
        List<Path> advices = adviceSources();

        // when / then
        assertThat(advices).allSatisfy(advice -> assertThat(Files.readString(advice))
                .as("%s must log the userAccountId, never a person. Source text is all this scan "
                        + "reads: a value arriving inside a framework exception's message is beyond "
                        + "it, and only a test that reads what was logged can see one", advice)
                .doesNotContain("getEmail", "getDisplayName", "getFirstName", "getLastName"));
    }

    @Test
    void givenTheAdvicesOnTheClassPath_whenTheirSourcesAreScanned_thenEveryExceptionHandlerCallsLogAnswered()
            throws IOException {
        // given
        List<Path> advices = adviceSources();

        // when
        List<String> handlerBodies = new ArrayList<>();
        for (Path advice : advices) {
            handlerBodies.addAll(handlerBodies(Files.readString(advice)));
        }

        // then
        assertThat(handlerBodies).isNotEmpty();
        assertThat(handlerBodies).allSatisfy(body -> assertThat(body)
                .as("every @ExceptionHandler method of an advice must call logAnswered so a new "
                        + "handler cannot ship silent")
                .contains("logAnswered("));
    }

    @Test
    void givenAnAdviceWhoseHandlerCarriesNoAttribute_whenItIsScanned_thenItsSilentBodyIsRead() {
        // given
        String advice = """
                @RestControllerAdvice
                class BareHandlerAdvice {

                    @ExceptionHandler
                    ProblemDetail handleAnything(IllegalStateException exception) {
                        return ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
                    }
                }
                """;

        // when
        List<String> handlerBodies = handlerBodies(advice);

        // then
        assertThat(handlerBodies).singleElement(STRING)
                .as("a handler that infers its exception type from its parameter must be read like "
                        + "any other, or the guard passes on an advice that ships silent")
                .doesNotContain("logAnswered(");
    }

    private static List<Path> adviceSources() {
        ClassPathScanningCandidateComponentProvider scanner =
                new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(ControllerAdvice.class));
        List<Path> sources = scanner.findCandidateComponents(OWNED_PACKAGE_PREFIX).stream()
                .map(BeanDefinition::getBeanClassName)
                .map(name -> Path.of("src/main/java", name.replace('.', '/') + ".java"))
                .sorted()
                .toList();
        assertThat(sources)
                .as("every advice on this application's class path must resolve to a source file, "
                        + "or a scan of those files covers less than it claims")
                .isNotEmpty()
                .allSatisfy(source -> assertThat(source).exists());
        return sources;
    }

    private static List<String> handlerBodies(String source) {
        List<String> bodies = new ArrayList<>();
        Matcher handlers = EXCEPTION_HANDLER.matcher(source);
        while (handlers.find()) {
            bodies.add(handlerMethodBody(source, handlers.start()));
        }
        return bodies;
    }

    private static String handlerMethodBody(String source, int handlerStart) {
        int attributesOpen = attributeListStart(source, handlerStart);
        int signatureStart = attributesOpen < 0
                ? handlerStart
                : matchingClose(source, attributesOpen, '(', ')');
        int bodyStart = source.indexOf('{', signatureStart);
        int bodyEnd = matchingClose(source, bodyStart, '{', '}');
        return source.substring(handlerStart, bodyEnd + 1);
    }

    private static int attributeListStart(String source, int handlerStart) {
        int index = handlerStart + EXCEPTION_HANDLER_ANNOTATION.length();
        while (index < source.length() && Character.isWhitespace(source.charAt(index))) {
            index++;
        }
        return index < source.length() && source.charAt(index) == '(' ? index : -1;
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

    private static String causeChainOf(ILoggingEvent event) {
        StringBuilder messages = new StringBuilder();
        for (IThrowableProxy proxy = event.getThrowableProxy(); proxy != null; proxy = proxy.getCause()) {
            messages.append(proxy.getMessage()).append('\n');
        }
        return messages.toString();
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

    private static final class ConflictFailure extends CodedDomainFailure {
        ConflictFailure(String code, Map<String, Object> params) {
            super(code, params);
        }

        @Override
        public ProblemType problemType() {
            return CONFLICT;
        }
    }

    private static final class ServerErrorFailure extends DomainFailure {
        ServerErrorFailure(String message, Throwable cause) {
            super(message, cause);
        }

        @Override
        public ProblemType problemType() {
            return SERVER_ERROR;
        }
    }
}
