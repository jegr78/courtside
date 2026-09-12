package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.UnexpectedTypeException;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Size;

import java.io.IOException;
import java.lang.reflect.Method;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class GeneratedApiImplementationTest extends AbstractIntegrationTest {

    // The filter chain answers both before any handler is consulted, so nothing can implement
    // SessionApi. The document describes them because a client has to know they exist.
    private static final Set<String> ANSWERED_BY_THE_FILTER_CHAIN = Set.of("SessionApi");

    // The servlet container dispatches to this one, so its route cannot come from the API document.
    private static final Set<String> ROUTED_BY_THE_CONTAINER = Set.of("ContainerErrorController.java");

    private static final Set<String> MAPPING_ANNOTATIONS = Set.of(
            "@RequestMapping", "@GetMapping", "@PostMapping", "@PutMapping", "@DeleteMapping",
            "@PatchMapping");

    @Autowired
    private ApplicationContext context;

    @Autowired
    private Validator validator;

    @Test
    void whenReadingEveryGeneratedApiInterface_thenEachIsImplementedByAController()
            throws IOException, URISyntaxException {
        // given
        Set<String> implemented = context.getBeansWithAnnotation(RestController.class).values()
                .stream()
                // Through the proxy: a controller Spring has wrapped reports the proxy's own
                // interfaces, not the ones it was written to implement.
                .flatMap(controller -> Stream.of(AopUtils.getTargetClass(controller).getInterfaces()))
                .map(Class::getSimpleName)
                .collect(Collectors.toCollection(TreeSet::new));

        // when
        Set<String> generated = generatedApiInterfaces();

        // then
        assertThat(generated).as("the generator must produce API interfaces at all").isNotEmpty();
        assertThat(implemented)
                .as("every generated API interface must be implemented by a @RestController, or"
                        + " named in ANSWERED_BY_THE_FILTER_CHAIN with the reason it cannot be")
                .containsAll(generated);
    }

    @Test
    void whenReadingEveryController_thenNoneDeclaresItsOwnRequestMapping() throws IOException {
        // given
        TreeSet<String> offenders = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            sources.filter(path -> path.toString().endsWith("Controller.java"))
                    .filter(GeneratedApiImplementationTest::declaresAMapping)
                    .map(path -> path.getFileName().toString())
                    .filter(name -> !ROUTED_BY_THE_CONTAINER.contains(name))
                    .forEach(offenders::add);
        }

        // then
        assertThat(offenders)
                .as("a controller states its routes by implementing its generated interface;"
                        + " change the API document instead")
                .isEmpty();
    }

    @Test
    void whenValidatingEverySizeConstraintTheGeneratorEmits_thenAValidatorResolvesForItsType()
            throws Exception {
        // given
        List<Class<?>> constrained = generatedApiTypes().stream()
                .filter(type -> !sizeConstrainedProperties(type).isEmpty()).toList();

        // when
        TreeSet<String> unresolved = new TreeSet<>();
        TreeSet<Class<?>> resolved = new TreeSet<>(Comparator.comparing(Class::getName));
        for (Class<?> type : constrained) {
            try {
                validator.validate(type.getDeclaredConstructor().newInstance());
                sizeConstrainedProperties(type)
                        .forEach(property -> resolved.add(property.getReturnType()));
            } catch (UnexpectedTypeException e) {
                unresolved.add(type.getSimpleName() + ": " + e.getMessage());
            }
        }
        for (Class<?> type : generatedApiTypes()) {
            Stream.of(type.getDeclaredMethods())
                    .flatMap(method -> Stream.of(method.getParameters()))
                    .filter(parameter -> parameter.isAnnotationPresent(Size.class))
                    .filter(parameter -> resolved.stream()
                            .noneMatch(known -> known.isAssignableFrom(parameter.getType())))
                    .forEach(parameter -> unresolved.add(
                            type.getSimpleName() + ": " + parameter.getType().getSimpleName()));
        }

        // then
        assertThat(constrained).as("the generator must emit @Size at all").isNotEmpty();
        assertThat(unresolved)
                .as("MeasuresLengthInCodePoints replaces the built-in @Size validators rather than"
                        + " adding to them, so a bound the generator emits on a type the"
                        + " replacement does not cover would be declared in the document and"
                        + " enforced by nothing.")
                .isEmpty();
    }

    private static List<Method> sizeConstrainedProperties(Class<?> generated) {
        return Stream.of(generated.getDeclaredMethods())
                .filter(method -> method.getParameterCount() == 0)
                .filter(method -> method.isAnnotationPresent(Size.class)).toList();
    }

    private static List<Class<?>> generatedApiTypes() throws IOException, URISyntaxException {
        Path root = generatedRoot();
        try (Stream<Path> sources = Files.walk(root)) {
            List<Class<?>> types = new ArrayList<>();
            for (Path source : sources.filter(path -> path.toString().endsWith(".java")).sorted().toList()) {
                String relative = root.relativize(source).toString();
                types.add(Class.forName(relative.substring(0, relative.length() - ".java".length())
                        .replace(java.io.File.separatorChar, '.')));
            }
            return types;
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("A generated source has no compiled class", e);
        }
    }

    private static boolean declaresAMapping(Path source) {
        try {
            String content = Files.readString(source);
            return MAPPING_ANNOTATIONS.stream().anyMatch(content::contains);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }

    private static Set<String> generatedApiInterfaces() throws IOException, URISyntaxException {
        try (Stream<Path> sources = Files.walk(generatedRoot())) {
            return sources.map(path -> path.getFileName().toString())
                    .filter(name -> name.endsWith("Api.java"))
                    .map(name -> name.substring(0, name.length() - ".java".length()))
                    .filter(name -> !ANSWERED_BY_THE_FILTER_CHAIN.contains(name))
                    .collect(Collectors.toCollection(TreeSet::new));
        }
    }

    private static Path generatedRoot() throws URISyntaxException {
        return Path.of(CourtsideApplication.class.getProtectionDomain()
                        .getCodeSource().getLocation().toURI())
                .getParent()
                .resolve(Path.of("generated-sources", "openapi", "src", "main", "java"));
    }
}
