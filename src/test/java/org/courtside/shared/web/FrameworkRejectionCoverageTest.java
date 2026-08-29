package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// ProblemTypeUriTest reads the type literals the advices write, so it cannot see a rejection no
// advice answers at all. This reads Spring's own list of them instead.
class FrameworkRejectionCoverageTest {

    private static final Map<String, String> ANSWERED_BY_THE_CONTAINER = Map.of(
            "org.springframework.web.servlet.NoHandlerFoundException",
            "Spring raises it only when throw-exception-if-no-handler-found is set, and it is not; "
                    + "an unmapped path arrives as NoResourceFoundException, which is answered",
            "org.springframework.web.context.request.async.AsyncRequestNotUsableException",
            "The client is gone and the response cannot be written, so there is no answer to type",
            "org.springframework.web.context.request.async.AsyncRequestTimeoutException",
            "No handler method returns DeferredResult, Callable, StreamingResponseBody or an emitter, "
                    + "so no request is ever dispatched asynchronously");

    @Test
    void whenSpringNamesAWebRejection_thenAnAdviceAnswersItWithAProblemType() throws Exception {
        // given
        Set<Class<?>> answered = advisedExceptions();

        // when
        List<String> unanswered = springWebRejections().stream()
                .filter(rejection -> answered.stream().noneMatch(handled -> handled.isAssignableFrom(rejection)))
                .map(Class::getName)
                .filter(name -> !ANSWERED_BY_THE_CONTAINER.containsKey(name))
                .toList();

        // then
        assertThat(unanswered)
                .as("Spring answers these itself, with a ProblemDetail carrying no type at all")
                .isEmpty();
    }

    @Test
    void whenARejectionIsExcused_thenItIsStillOneSpringCanRaiseAndNoAdviceAnswers() throws Exception {
        // given
        Set<Class<?>> answered = advisedExceptions();
        Set<String> raised = springWebRejections().stream().map(Class::getName)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());

        // when / then
        assertThat(ANSWERED_BY_THE_CONTAINER.keySet())
                .as("an excuse for a rejection Spring no longer raises outlives its reason")
                .allSatisfy(name -> assertThat(raised).contains(name));
        assertThat(ANSWERED_BY_THE_CONTAINER.keySet().stream()
                .filter(name -> answered.stream().anyMatch(handled -> handled.getName().equals(name)))
                .toList())
                .as("an excuse for a rejection an advice does answer is a stale entry")
                .isEmpty();
    }

    private static List<Class<?>> springWebRejections() {
        return Arrays.stream(ResponseEntityExceptionHandler.class.getDeclaredMethods())
                .map(method -> method.getAnnotation(ExceptionHandler.class))
                .filter(java.util.Objects::nonNull)
                .flatMap(annotation -> Arrays.stream(annotation.value()))
                .<Class<?>>map(type -> type)
                .toList();
    }

    private static Set<Class<?>> advisedExceptions() throws IOException {
        Set<Class<?>> handled = new LinkedHashSet<>();
        for (Path source : adviceSources()) {
            String content = Files.readString(source);
            Matcher declarations = Pattern.compile("@ExceptionHandler\\(([^)]*)\\)",
                    Pattern.DOTALL).matcher(content);
            while (declarations.find()) {
                Matcher named = Pattern.compile("(\\w+)\\.class").matcher(declarations.group(1));
                while (named.find()) {
                    resolve(named.group(1), content).ifPresent(handled::add);
                }
            }
        }
        assertThat(handled).as("no advice was read, so this proves nothing").isNotEmpty();
        return handled;
    }

    private static java.util.Optional<Class<?>> resolve(String simpleName, String content) {
        Matcher matcher = Pattern.compile("^import ([\\w.]+\\." + Pattern.quote(simpleName) + ");$",
                Pattern.MULTILINE).matcher(content);
        if (!matcher.find()) {
            return java.util.Optional.empty();
        }
        try {
            return java.util.Optional.of(Class.forName(matcher.group(1)));
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("an advice names a type that does not exist", e);
        }
    }

    private static List<Path> adviceSources() throws IOException {
        try (Stream<Path> files = Files.walk(Path.of("src/main/java"))) {
            return files.filter(path -> path.toString().endsWith(".java"))
                    .filter(FrameworkRejectionCoverageTest::isAdvice)
                    .toList();
        }
    }

    private static boolean isAdvice(Path path) {
        try {
            return Files.readString(path).contains("@RestControllerAdvice");
        } catch (IOException e) {
            throw new IllegalStateException("a source file under src/main/java could not be read", e);
        }
    }
}
