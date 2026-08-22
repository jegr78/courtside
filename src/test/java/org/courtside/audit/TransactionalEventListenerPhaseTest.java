package org.courtside.audit;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class TransactionalEventListenerPhaseTest {

    private static final String ANNOTATION = "@TransactionalEventListener";

    @Test
    void whenScanningEverySource_thenExactlyOneTransactionalEventListenerExistsAtBeforeCommit() throws IOException {
        // given / when
        List<String> annotated;
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            annotated = sources.filter(path -> path.toString().endsWith(".java"))
                    .filter(TransactionalEventListenerPhaseTest::declaresListener)
                    .map(path -> Path.of("src/main/java").relativize(path).toString())
                    .toList();
        }

        // then
        List<String> beforeCommit = annotated.stream()
                .filter(TransactionalEventListenerPhaseTest::listensBeforeCommit).toList();
        assertThat(beforeCommit).as(
                        "Section 3 of docs/design.md states the audit guarantee rests on exactly one "
                                + ANNOTATION + " registered at BEFORE_COMMIT: no commit without a row. A "
                                + "second one there, or that phase moved off the audit writer, makes that "
                                + "sentence false; update the design specification in the same change.")
                .containsExactly("org/courtside/audit/internal/DomainEventWriter.java");
        assertThat(Files.readString(Path.of("src/main/java", beforeCommit.getFirst())))
                .contains(ANNOTATION + "(phase = TransactionPhase.BEFORE_COMMIT)");
    }

    private static boolean listensBeforeCommit(String relative) {
        return read(Path.of("src/main/java", relative)).contains("TransactionPhase.BEFORE_COMMIT");
    }

    private static String read(Path source) {
        try {
            return Files.readString(source);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }

    private static boolean declaresListener(Path source) {
        try {
            return Files.readString(source).contains(ANNOTATION);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }
}
