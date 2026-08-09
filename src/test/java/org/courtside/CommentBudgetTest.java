package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// CLAUDE.md has asked for one-line comments since the first commit, and the codebase drifted to
// eleven-line ones anyway. A rule this repository does not test is a rule it has already lost.
class CommentBudgetTest {

    private static final int MOST_LINES_A_COMMENT_MAY_HAVE = 2;

    // Every file type CLAUDE.md's rule names, by how each one starts a comment.
    private static final Map<String, String> COMMENT_START = Map.of(
            ".java", "//",
            ".sql", "--",
            ".yaml", "#",
            ".yml", "#");

    // The Maven wrapper is the Apache Software Foundation's code, not this project's — see NOTICE.
    private static final List<Path> ROOTS = List.of(
            Path.of("src/main"), Path.of("src/test"), Path.of(".github"), Path.of("deploy"));

    // A required marker begins its own comment, so "// given — why" followed by "// when / then"
    // is two comments and not a three-line one.
    private static final Pattern MARKER = Pattern.compile("//\\s*(given|when|then)\\b.*");

    private static final Pattern XML_COMMENT = Pattern.compile("<!--.*?-->", Pattern.DOTALL);

    @Test
    void whenReadingEverySourceFile_thenNoCommentRunsLongerThanTheBudget() throws IOException {
        // given
        List<String> tooLong = new ArrayList<>();

        // when
        for (Path root : ROOTS) {
            try (Stream<Path> sources = Files.walk(root)) {
                sources.filter(Files::isRegularFile).sorted()
                        .forEach(path -> collectLineComments(path, tooLong));
            }
        }
        collectXmlComments(Path.of("pom.xml"), tooLong);

        // then
        assertThat(tooLong)
                .as("a comment is one line, and the second only so a sentence may wrap. What does"
                        + " not fit belongs in the commit message and the pull request body, where"
                        + " a reader goes to ask why and where it does not rot")
                .isEmpty();
    }

    private static void collectLineComments(Path source, List<String> tooLong) {
        String start = COMMENT_START.entrySet().stream()
                .filter(entry -> source.toString().endsWith(entry.getKey()))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElse(null);
        if (start == null) {
            return;
        }

        List<String> lines = readLines(source);
        int run = 0;
        for (int index = 0; index <= lines.size(); index++) {
            String line = index < lines.size() ? lines.get(index).strip() : "";
            boolean isComment = line.startsWith(start);
            if (isComment && !MARKER.matcher(line).matches()) {
                run++;
                continue;
            }
            report(source, index - run + 1, run, tooLong);
            run = isComment ? 1 : 0;
        }
    }

    private static void collectXmlComments(Path source, List<String> tooLong) {
        String content = readContent(source);
        Matcher comments = XML_COMMENT.matcher(content);
        while (comments.find()) {
            int line = (int) content.substring(0, comments.start()).lines().count() + 1;
            report(source, line, (int) comments.group().lines().count(), tooLong);
        }
    }

    private static void report(Path source, int line, int lines, List<String> tooLong) {
        if (lines > MOST_LINES_A_COMMENT_MAY_HAVE) {
            tooLong.add("%s:%d — %d lines".formatted(source, line, lines));
        }
    }

    private static List<String> readLines(Path source) {
        return readContent(source).lines().toList();
    }

    private static String readContent(Path source) {
        try {
            return Files.readString(source);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }
}
