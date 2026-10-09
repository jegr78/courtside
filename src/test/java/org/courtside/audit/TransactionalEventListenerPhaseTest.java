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

    private static final List<String> WRITES_IN_THE_COMMITTING_TRANSACTION = List.of(
            "org/courtside/audit/internal/DomainEventWriter.java",
            "org/courtside/notification/internal/BookingMailer.java",
            "org/courtside/notification/internal/CredentialMailer.java",
            "org/courtside/notification/internal/DisplacementMailer.java",
            "org/courtside/notification/internal/ParticipationMailer.java",
            "org/courtside/notification/internal/PasswordResetCodeMailer.java",
            "org/courtside/notification/internal/ReminderMailer.java",
            "org/courtside/notification/internal/UsernameReminderMailer.java");

    @Test
    void whenScanningEverySource_thenOnlyTheAuditAndOutboxListenersRunBeforeCommit() throws IOException {
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
                        "only the audit row and the outbox rows are written by an " + ANNOTATION
                                + " at BEFORE_COMMIT: no commit without them, and nothing else inside")
                .containsExactlyInAnyOrderElementsOf(WRITES_IN_THE_COMMITTING_TRANSACTION);
        assertThat(beforeCommit).allSatisfy(source -> assertThat(read(Path.of("src/main/java", source)))
                .as("%s must register its listener at BEFORE_COMMIT", source)
                .contains(ANNOTATION + "(phase = TransactionPhase.BEFORE_COMMIT"));
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
