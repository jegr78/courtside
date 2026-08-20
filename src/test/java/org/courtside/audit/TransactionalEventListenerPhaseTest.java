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
        assertThat(annotated).as(
                        "Section 3 of docs/design.md states the audit guarantee rests on there being "
                                + "exactly one " + ANNOTATION + ", registered at BEFORE_COMMIT. A second "
                                + "listener, or a phase moved off BEFORE_COMMIT, makes that sentence false; "
                                + "update the design specification in the same change that adds or moves one.")
                .containsExactly("org/courtside/audit/internal/DomainEventWriter.java");
        assertThat(Files.readString(Path.of("src/main/java", annotated.getFirst())))
                .contains(ANNOTATION + "(phase = TransactionPhase.BEFORE_COMMIT)");
    }

    private static boolean declaresListener(Path source) {
        try {
            return Files.readString(source).contains(ANNOTATION);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + source, e);
        }
    }
}
