package org.courtside.audit;

import org.courtside.audit.internal.AuditService;
import org.courtside.shared.ConfigurationSubjectNames;
import org.junit.jupiter.api.Test;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class SubjectNameResolutionTest {

    private static final UUID KNOWN_TO_ONE = UUID.randomUUID();
    private static final UUID KNOWN_TO_ANOTHER = UUID.randomUUID();
    private static final UUID KNOWN_TO_NOBODY = UUID.randomUUID();

    private static ConfigurationSubjectNames answering(UUID id, String name) {
        return subjectIds -> subjectIds.contains(id) ? Map.of(id, name) : Map.of();
    }

    @Test
    void givenSeveralSources_whenNamesAreResolved_thenEachAnswersOnlyForWhatItKnows() {
        // given
        AuditService service = new AuditService(null, null, List.of(
                answering(KNOWN_TO_ONE, "Court 1"),
                answering(KNOWN_TO_ANOTHER, "Summer rules")));

        // when
        Map<UUID, String> names = service.namesFor(
                List.of(KNOWN_TO_ONE, KNOWN_TO_ANOTHER, KNOWN_TO_NOBODY));

        // then
        assertThat(names)
                .containsEntry(KNOWN_TO_ONE, "Court 1")
                .containsEntry(KNOWN_TO_ANOTHER, "Summer rules")
                .doesNotContainKey(KNOWN_TO_NOBODY);
    }

    @Test
    void givenNoSubjects_whenNamesAreResolved_thenNoSourceIsAsked() {
        // given
        AuditService service = new AuditService(null, null, List.of(subjectIds -> {
            throw new IllegalStateException("asked for an empty page");
        }));

        // when
        Map<UUID, String> names = service.namesFor(List.of());

        // then
        assertThat(names).isEmpty();
    }
}
