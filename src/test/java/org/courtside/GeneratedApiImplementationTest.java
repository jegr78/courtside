package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.constraints.Size;

import java.io.IOException;
import java.lang.reflect.AnnotatedElement;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
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
    void whenReadingEverySizeConstraintTheGeneratorEmits_thenThisApplicationValidatesItsType()
            throws Exception {
        // given
        List<Class<?>> validated = validatedBySizeMapping();

        // when
        TreeSet<String> unvalidated = new TreeSet<>();
        for (Class<?> generated : generatedApiTypes()) {
            for (AnnotatedElement element : sizeConstrained(generated)) {
                Class<?> constrained = typeOf(element);
                if (validated.stream().noneMatch(family -> family.isAssignableFrom(constrained))) {
                    unvalidated.add(generated.getSimpleName() + " " + constrained.getSimpleName());
                }
            }
        }

        // then
        assertThat(validated).as("the size mapping must declare validators at all").isNotEmpty();
        assertThat(unvalidated)
                .as("MeasuresLengthInCodePoints replaces the built-in @Size validators rather than"
                        + " adding to them, so a bound the generator emits on a type it does not"
                        + " cover would be declared in the document and enforced by nothing.")
                .isEmpty();
    }

    private static List<Class<?>> validatedBySizeMapping() throws ClassNotFoundException {
        List<Class<?>> validated = new ArrayList<>();
        for (Class<?> validator
                : Class.forName("org.courtside.shared.MeasuresLengthInCodePoints").getDeclaredClasses()) {
            for (Type implemented : validator.getGenericInterfaces()) {
                if (implemented instanceof ParameterizedType parameterized
                        && parameterized.getRawType() == jakarta.validation.ConstraintValidator.class) {
                    validated.add(rawTypeOf(parameterized.getActualTypeArguments()[1]));
                }
            }
        }
        return validated;
    }

    private static List<AnnotatedElement> sizeConstrained(Class<?> generated) {
        List<AnnotatedElement> constrained = new ArrayList<>();
        Stream.of(generated.getDeclaredFields()).filter(field -> field.isAnnotationPresent(Size.class))
                .forEach(constrained::add);
        Stream.of(generated.getDeclaredMethods()).forEach(method -> {
            if (method.isAnnotationPresent(Size.class)) {
                constrained.add(method);
            }
            Stream.of(method.getParameters())
                    .filter(parameter -> parameter.isAnnotationPresent(Size.class))
                    .forEach(constrained::add);
        });
        return constrained;
    }

    private static Class<?> typeOf(AnnotatedElement element) {
        return switch (element) {
            case java.lang.reflect.Field field -> field.getType();
            case java.lang.reflect.Method method -> method.getReturnType();
            case java.lang.reflect.Parameter parameter -> parameter.getType();
            default -> throw new IllegalStateException("Unexpected constrained element " + element);
        };
    }

    private static Class<?> rawTypeOf(Type type) {
        return type instanceof ParameterizedType parameterized
                ? (Class<?>) parameterized.getRawType() : (Class<?>) type;
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
