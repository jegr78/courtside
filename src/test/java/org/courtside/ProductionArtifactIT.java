package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.jar.JarFile;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

// Surefire runs before either artifact exists, so the integration phase is the only place that can
// read them, and the fixture set is taken from the fixture artifact rather than named a second time.
class ProductionArtifactIT {

    private static final String PACKAGED_CLASSES = "BOOT-INF/classes/";
    private static final String SHARED_REGISTRATION = "META-INF/spring.factories";
    private static final String MANIFEST = "META-INF/MANIFEST.MF";
    private static final String EXCLUSION_RECORD = "META-INF/courtside-excluded-fixtures.txt";

    @Test
    void givenTheFixtureArtifact_whenTheProductionArtifactIsRead_thenItCarriesNoFixtureFile()
            throws IOException {
        // given
        Set<String> fixtures = fixtureContent();

        // when
        Set<String> production = productionContent();

        // then
        assertThat(fixtures).as("the fixture artifact carries nothing").isNotEmpty();
        assertThat(fixtures).as("the fixture artifact carries no class")
                .anyMatch(file -> file.endsWith(".class"));
        assertThat(fixtures.stream().filter(file -> !file.equals(SHARED_REGISTRATION))
                .filter(production::contains).toList())
                .as("the production artifact still ships fixture files").isEmpty();
    }

    @Test
    void whenBothArtifactsAreRead_thenEveryCompiledFileIsInExactlyOneOfThem() throws IOException {
        // given
        Set<String> compiled = compiledOutput();
        Set<String> fixtures = fixtureContent();

        // when
        Set<String> production = productionContent();

        // then
        assertThat(compiled).as("the compiled output was not read").isNotEmpty();
        assertThat(compiled.stream()
                .filter(file -> production.contains(file) == fixtures.contains(file)).toList())
                .as("a compiled file is in both artifacts or in neither").isEmpty();
    }

    @Test
    void givenTheFixtureArtifact_whenTheExclusionRecordIsRead_thenItNamesEveryFixtureFile()
            throws IOException {
        // given
        Set<String> fixtures = fixtureContent();

        // when
        Set<String> recorded = recordedExclusions();

        // then
        assertThat(recorded).as("the exclusion record and the fixture artifact disagree")
                .containsExactlyInAnyOrderElementsOf(fixtures);
    }

    private static Set<String> recordedExclusions() throws IOException {
        try (JarFile jar = new JarFile(productionArtifact().toFile())) {
            if (jar.getEntry(EXCLUSION_RECORD) == null) return Set.of();
            try (InputStream source = jar.getInputStream(jar.getEntry(EXCLUSION_RECORD));
                 BufferedReader lines = new BufferedReader(new InputStreamReader(source, UTF_8))) {
                return lines.lines()
                        .map(String::trim)
                        .filter(line -> !line.isEmpty())
                        .collect(Collectors.toCollection(TreeSet::new));
            }
        }
    }

    @Test
    void whenBothArtifactsAreRead_thenEachRegistersOnlyTheFactoriesItCarries() throws IOException {
        // given
        Set<String> productionFactories = registeredFactories(productionArtifact(), SHARED_REGISTRATION);
        Set<String> fixtureFactories = registeredFactories(fixtureArtifact(), SHARED_REGISTRATION);

        // when
        Set<String> production = productionContent();
        Set<String> fixtures = fixtureContent();

        // then
        assertThat(content(productionArtifact()))
                .as("the fixture overlay would shadow the production registrations")
                .contains(SHARED_REGISTRATION)
                .doesNotContain(PACKAGED_CLASSES + SHARED_REGISTRATION);
        assertThat(productionFactories).as("the production artifact registers no factory").isNotEmpty();
        assertThat(fixtureFactories).as("the fixture artifact registers no factory").isNotEmpty();
        assertThat(missing(productionFactories, production))
                .as("the production artifact registers a factory it does not carry").isEmpty();
        assertThat(missing(fixtureFactories, fixtures))
                .as("the fixture artifact registers a factory it does not carry").isEmpty();
        assertThat(productionFactories.stream().filter(fixtureFactories::contains).toList())
                .as("both artifacts register the same factory").isEmpty();
    }

    private static List<String> missing(Set<String> factories, Set<String> content) {
        return factories.stream()
                .filter(name -> !content.contains(name.replace('.', '/') + ".class"))
                .toList();
    }

    private static Set<String> registeredFactories(Path artifact, String registration) throws IOException {
        try (JarFile jar = new JarFile(artifact.toFile())) {
            if (jar.getEntry(registration) == null) return Set.of();
            Properties declarations = new Properties();
            try (InputStream source = jar.getInputStream(jar.getEntry(registration))) {
                declarations.load(source);
            }
            return declarations.stringPropertyNames().stream()
                    .flatMap(key -> Arrays.stream(declarations.getProperty(key).split(",")))
                    .map(String::trim)
                    .filter(name -> !name.isEmpty())
                    .collect(Collectors.toCollection(TreeSet::new));
        }
    }

    private static Set<String> productionContent() throws IOException {
        return content(productionArtifact()).stream()
                .map(file -> file.startsWith(PACKAGED_CLASSES) ? file.substring(PACKAGED_CLASSES.length()) : file)
                .collect(Collectors.toCollection(TreeSet::new));
    }

    private static Set<String> fixtureContent() throws IOException {
        return content(fixtureArtifact());
    }

    private static Set<String> content(Path artifact) throws IOException {
        try (JarFile jar = new JarFile(artifact.toFile())) {
            return jar.stream()
                    .filter(entry -> !entry.isDirectory())
                    .map(entry -> entry.getName())
                    .filter(name -> !name.equals(MANIFEST))
                    .collect(Collectors.toCollection(TreeSet::new));
        }
    }

    private static Set<String> compiledOutput() throws IOException {
        Path classes = Path.of("target", "classes");
        try (Stream<Path> files = Files.walk(classes)) {
            return files.filter(Files::isRegularFile)
                    .map(file -> classes.relativize(file).toString().replace('\\', '/'))
                    .filter(file -> !file.equals(SHARED_REGISTRATION))
                    .collect(Collectors.toCollection(TreeSet::new));
        }
    }

    private static Path productionArtifact() throws IOException {
        return single(Path.of("target"), name -> name.startsWith("courtside-") && name.endsWith(".jar"));
    }

    private static Path fixtureArtifact() throws IOException {
        return single(Path.of("target", "fixtures"), name -> name.endsWith("-fixtures.jar"));
    }

    private static Path single(Path directory, Predicate<String> selection) throws IOException {
        try (Stream<Path> files = Files.list(directory)) {
            return files.filter(file -> selection.test(file.getFileName().toString()))
                    .reduce((first, second) -> {
                        throw new UncheckedIOException(
                                new IOException("More than one artifact matches in " + directory));
                    })
                    .orElseThrow(() -> new IOException("No artifact matches in " + directory));
        }
    }
}
