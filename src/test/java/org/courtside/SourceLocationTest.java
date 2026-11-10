package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class SourceLocationTest {

    private static final Pattern PACKAGE = Pattern.compile("^package\\s+([\\w.]+)\\s*;", Pattern.MULTILINE);

    private static final List<Path> ROOTS = List.of(Path.of("src/main/java"), Path.of("src/test/java"));

    @Test
    void whenReadingEveryJavaSource_thenItsDirectoryMatchesItsPackage() throws IOException {
        // given
        TreeSet<String> misplaced = new TreeSet<>();

        // when
        for (Path root : ROOTS) {
            try (Stream<Path> sources = Files.walk(root)) {
                sources.filter(path -> path.toString().endsWith(".java"))
                        .filter(path -> !declaredPackage(path).equals(directoryPackage(root, path)))
                        .forEach(path -> misplaced.add(path + " declares " + declaredPackage(path)));
            }
        }

        // then
        assertThat(misplaced)
                .as("a source whose directory differs from its package hides from every scan that maps a"
                        + " path to a class, and from a reader looking for it")
                .isEmpty();
    }

    private static String directoryPackage(Path root, Path source) {
        Path directory = root.relativize(source).getParent();
        return directory == null ? "" : directory.toString().replace(source.getFileSystem().getSeparator(), ".");
    }

    private static String declaredPackage(Path source) {
        try {
            Matcher declaration = PACKAGE.matcher(Files.readString(source));
            return declaration.find() ? declaration.group(1) : "";
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }
}
