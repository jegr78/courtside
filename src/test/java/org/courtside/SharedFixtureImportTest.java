package org.courtside;

import org.junit.jupiter.api.Test;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.Nested;
import org.springframework.context.annotation.Import;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.core.annotation.MergedAnnotations.SearchStrategy;

import java.io.IOException;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class SharedFixtureImportTest {

    private static final Pattern PACKAGE = Pattern.compile("^package\\s+([\\w.]+)\\s*;", Pattern.MULTILINE);

    private static final Path JAVA_SOURCES = Path.of("src/test/java");

    private static final Path THIS_SOURCE = JAVA_SOURCES.resolve("org/courtside/SharedFixtureImportTest.java");

    private static final List<Class<?>> SHARED =
            List.of(AbstractIntegrationTest.class.getAnnotation(Import.class).value());

    @Test
    void whenReadingEveryIntegrationTest_thenNoneImportsAgainWhatTheSharedContextImports() throws IOException {
        // given
        TreeSet<String> repeated = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(JAVA_SOURCES)) {
            sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(path -> !path.endsWith("package-info.java"))
                    .filter(path -> !path.equals(THIS_SOURCE))
                    .map(SharedFixtureImportTest::compiledClass)
                    .forEach(type -> collectRepeated(type, false, repeated));
        }

        // then
        assertThat(repeated)
                .as("AbstractIntegrationTest already imports every fixture; a test's own @Import names"
                        + " only what that test adds")
                .isEmpty();
    }

    @Test
    void givenImportsInEveryPlacement_whenClassified_thenEachRepetitionInsideAnIntegrationTestIsFound() {
        // given
        TreeSet<String> repeated = new TreeSet<>();

        // when
        collectRepeated(SharedFixtureImportTest.class, false, repeated);

        // then
        assertThat(repeated).containsExactlyInAnyOrder(
                ComposedImport.class.getName() + " -> IdentityTestFixture",
                ComposedImport.Inner.class.getName() + " -> MemberTestFixture");
    }

    private static void collectRepeated(Class<?> type, boolean insideIntegrationTest, TreeSet<String> repeated) {
        boolean integration = insideIntegrationTest
                || (type != AbstractIntegrationTest.class && AbstractIntegrationTest.class.isAssignableFrom(type));
        if (integration) {
            MergedAnnotations.from(type, SearchStrategy.DIRECT).stream(Import.class)
                    .flatMap(imports -> Arrays.stream(imports.getClassArray("value")))
                    .filter(SHARED::contains)
                    .forEach(fixture -> repeated.add(type.getName() + " -> " + fixture.getSimpleName()));
        }
        Arrays.stream(type.getDeclaredClasses()).forEach(nested -> collectRepeated(nested, integration, repeated));
    }

    private static String read(Path source) {
        try {
            return Files.readString(source);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }

    private static Class<?> compiledClass(Path source) {
        Matcher declaration = PACKAGE.matcher(read(source));
        String simpleName = source.getFileName().toString().replaceAll("\\.java$", "");
        String name = declaration.find() ? declaration.group(1) + "." + simpleName : simpleName;
        try {
            return Class.forName(name, false, SharedFixtureImportTest.class.getClassLoader());
        } catch (ClassNotFoundException missing) {
            throw new IllegalStateException("No compiled class for " + source, missing);
        }
    }

    @Retention(RetentionPolicy.RUNTIME)
    @Import(IdentityTestFixture.class)
    @interface ImportsIdentity {
    }

    @ImportsIdentity
    abstract static class ComposedImport extends AbstractIntegrationTest {

        @Nested
        @Import({MemberTestFixture.class, Plain.class})
        class Inner {
        }
    }

    @Import(IdentityTestFixture.class)
    static class Plain {
    }
}
