package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// ApiContractCoverageTest compares paths, which a hand-written @GetMapping would still satisfy
// while drifting in media types, parameter names and shapes. Implementing the interface cannot.
class GeneratedApiImplementationTest extends AbstractIntegrationTest {

    // The filter chain answers both before any handler is consulted, so nothing can implement
    // SessionApi. The document describes them because a client has to know they exist.
    private static final Set<String> ANSWERED_BY_THE_FILTER_CHAIN = Set.of("SessionApi");

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
        // given — a mapping annotation on a controller is a route the document did not describe,
        // or one that describes it differently. Either way the two have stopped agreeing.
        TreeSet<String> offenders = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            sources.filter(path -> path.toString().endsWith("Controller.java"))
                    .filter(GeneratedApiImplementationTest::declaresAMapping)
                    .map(path -> path.getFileName().toString())
                    .forEach(offenders::add);
        }

        // then
        assertThat(offenders)
                .as("a controller states its routes by implementing its generated interface;"
                        + " change the API document instead")
                .isEmpty();
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
        Path root = Path.of(CourtsideApplication.class.getProtectionDomain()
                        .getCodeSource().getLocation().toURI())
                .getParent()
                .resolve(Path.of("generated-sources", "openapi", "src", "main", "java"));
        try (Stream<Path> sources = Files.walk(root)) {
            return sources.map(path -> path.getFileName().toString())
                    .filter(name -> name.endsWith("Api.java"))
                    .map(name -> name.substring(0, name.length() - ".java".length()))
                    .filter(name -> !ANSWERED_BY_THE_FILTER_CHAIN.contains(name))
                    .collect(Collectors.toCollection(TreeSet::new));
        }
    }
}
