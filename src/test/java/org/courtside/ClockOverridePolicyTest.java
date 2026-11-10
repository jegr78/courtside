package org.courtside;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ClockOverridePolicyTest {

    private static final Path TEST_SOURCES = Path.of("src/test");

    private static final Pattern PACKAGE = Pattern.compile("^package\\s+([\\w.]+)\\s*;", Pattern.MULTILINE);

    private static final Path JAVA_SOURCES = TEST_SOURCES.resolve("java");

    private static final Path THIS_SOURCE = JAVA_SOURCES.resolve("org/courtside/ClockOverridePolicyTest.java");

    private static final String CLOCK_PROPERTY = "courtside.test.clock";

    // The demo seeder is an ApplicationRunner and reads the clock while the context starts.
    private static final List<String> FILES_ALLOWED_TO_NAME_THE_PROPERTY = List.of(
            "java/org/courtside/FixedClockConfiguration.java",
            "java/org/courtside/DemoDataSeederTest.java");

    @Test
    void whenReadingEveryTestSource_thenOnlyAStartupClockSetsTheClockProperty() throws IOException {
        // given
        TreeSet<String> naming = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(TEST_SOURCES)) {
            sources.filter(Files::isRegularFile)
                    .filter(path -> !path.equals(THIS_SOURCE))
                    .filter(ClockOverridePolicyTest::namesTheClockProperty)
                    .map(path -> TEST_SOURCES.relativize(path).toString())
                    .forEach(naming::add);
        }

        // then
        assertThat(naming)
                .as("a test that needs another time names it with @ClockAt on an AbstractIntegrationTest"
                        + " subclass; the property starts a separate Spring context for every value")
                .containsExactlyInAnyOrderElementsOf(FILES_ALLOWED_TO_NAME_THE_PROPERTY);
    }

    @Test
    void whenReadingEveryClockAtAnnotation_thenAnIntegrationTestReadsIt() throws IOException {
        // given
        TreeSet<String> unread = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(JAVA_SOURCES)) {
            sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !path.equals(THIS_SOURCE))
                    .filter(path -> !path.endsWith("package-info.java"))
                    .map(ClockOverridePolicyTest::topLevelClass)
                    .forEach(type -> collectUnread(type, unread));
        }

        // then
        assertThat(unread)
                .as("only AbstractIntegrationTest reads @ClockAt; anywhere else the annotation is"
                        + " ignored and the test runs at the default instant")
                .isEmpty();
    }

    @Test
    void givenAnnotatedClassesInEveryPlacement_whenClassified_thenOnlyThoseOutsideAnIntegrationTestAreUnread() {
        // given
        TreeSet<String> unread = new TreeSet<>();

        // when
        collectUnread(ReadByItself.class, unread);
        collectUnread(ReadThroughNestedTest.class, unread);
        collectUnread(PlainTest.class, unread);
        collectUnread(IntegrationWithPlainNested.class, unread);

        // then
        assertThat(unread).containsExactlyInAnyOrder(PlainTest.class.getName(),
                IntegrationWithPlainNested.PlainNested.class.getName());
    }

    @Test
    void givenANestedYamlProperty_whenRead_thenItNamesTheClockLikeTheDottedKey() throws IOException {
        // given
        Path nested = Files.createTempFile("clock-policy", ".yaml");
        Path dotted = Files.createTempFile("clock-policy", ".yml");
        Path unrelated = Files.createTempFile("clock-policy", ".yaml");
        try {
            Files.writeString(nested, "courtside:\n  test:\n    clock: 2026-01-01T00:00:00Z\n");
            Files.writeString(dotted, "spring.main.banner-mode: off\n---\ncourtside.test.clock: 2026-01-01T00:00:00Z\n");
            Files.writeString(unrelated, "courtside:\n  test:\n    mail: off\n");

            // when / then
            assertThat(namesTheClockProperty(nested)).as("nested keys").isTrue();
            assertThat(namesTheClockProperty(dotted)).as("a dotted key in a later document").isTrue();
            assertThat(namesTheClockProperty(unrelated)).as("a sibling key").isFalse();
        } finally {
            Files.delete(nested);
            Files.delete(dotted);
            Files.delete(unrelated);
        }
    }

    private static boolean namesTheClockProperty(Path source) {
        String name = source.getFileName().toString();
        if (!name.endsWith(".yaml") && !name.endsWith(".yml")) {
            return read(source).contains(CLOCK_PROPERTY);
        }
        Set<String> keys = new HashSet<>();
        new Yaml().loadAll(read(source)).forEach(document -> flatten("", document, keys));
        return keys.contains(CLOCK_PROPERTY);
    }

    private static void flatten(String prefix, Object node, Set<String> keys) {
        if (node instanceof Map<?, ?> map) {
            map.forEach((key, value) -> flatten(prefix + key + ".", value, keys));
        } else if (!prefix.isEmpty()) {
            keys.add(prefix.substring(0, prefix.length() - 1));
        }
    }

    private static void collectUnread(Class<?> type, TreeSet<String> unread) {
        if (type.getDeclaredAnnotation(ClockAt.class) != null && !readsClockAt(type)) {
            unread.add(type.getName());
        }
        Arrays.stream(type.getDeclaredClasses()).forEach(nested -> collectUnread(nested, unread));
    }

    private static boolean readsClockAt(Class<?> type) {
        return AbstractIntegrationTest.class.isAssignableFrom(type)
                || Arrays.stream(type.getDeclaredClasses()).anyMatch(ClockOverridePolicyTest::readsClockAt);
    }

    private static Class<?> topLevelClass(Path source) {
        Matcher declaration = PACKAGE.matcher(read(source));
        String simpleName = source.getFileName().toString().replaceAll("\\.java$", "");
        String name = declaration.find() ? declaration.group(1) + "." + simpleName : simpleName;
        try {
            return Class.forName(name, false, ClockOverridePolicyTest.class.getClassLoader());
        } catch (ClassNotFoundException missing) {
            throw new IllegalStateException("No compiled class for " + source, missing);
        }
    }

    private static String read(Path source) {
        try {
            return Files.readString(source, StandardCharsets.ISO_8859_1);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }

    @ClockAt("2026-01-01T00:00:00Z")
    abstract static class ReadByItself extends AbstractIntegrationTest {
    }

    @ClockAt("2026-01-01T00:00:00Z")
    static class ReadThroughNestedTest {

        abstract static class NestedTest extends AbstractIntegrationTest {
        }
    }

    @ClockAt("2026-01-01T00:00:00Z")
    static class PlainTest {
    }

    abstract static class IntegrationWithPlainNested extends AbstractIntegrationTest {

        @ClockAt("2026-01-01T00:00:00Z")
        static class PlainNested {
        }
    }
}
