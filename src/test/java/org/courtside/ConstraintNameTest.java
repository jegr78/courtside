package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ConstraintNameTest {

    private static final Pattern DECLARATION = Pattern.compile(
            "static final String \\w*CONSTRAINT\\w*\\s*=\\s*\\n?\\s*\"([^\"]+)\"");

    @Test
    void whenReadingEveryConstraintNameTheCodeMatchesOn_thenAMigrationDeclaresIt() throws IOException {
        // given
        TreeSet<String> named = new TreeSet<>();
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            sources.filter(path -> path.toString().endsWith(".java"))
                    .forEach(path -> collect(path, named));
        }
        String migrations = migrations();

        // when
        List<String> missing = named.stream().filter(name -> !migrations.contains(name)).toList();

        // then
        assertThat(named)
                .as("a constant naming a database constraint is how a violation is translated into"
                        + " a typed failure; at least one is expected to exist")
                .isNotEmpty();
        assertThat(missing)
                .as("a renamed constraint would degrade the typed failure into the generic"
                        + " constraint-violation answer, silently and without a red test")
                .isEmpty();
    }

    private static String migrations() throws IOException {
        StringBuilder all = new StringBuilder();
        try (Stream<Path> files = Files.walk(Path.of("src/main/resources/db/migration"))) {
            for (Path file : files.filter(path -> path.toString().endsWith(".sql")).toList()) {
                all.append(Files.readString(file));
            }
        }
        return all.toString();
    }

    private static void collect(Path source, TreeSet<String> named) {
        try {
            Matcher matcher = DECLARATION.matcher(Files.readString(source));
            List<String> found = new ArrayList<>();
            matcher.results().forEach(result -> found.add(result.group(1)));
            named.addAll(found);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }
}
