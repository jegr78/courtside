package org.courtside.dataexchange;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.DomainEventTypes;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({AuditTestFixture.class, IdentityTestFixture.class})
class ImportAuditTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final List<String> CHANGE_EVENT_TYPES =
            DomainEventTypes.typesOf(DataExchangeEvent.class);

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private ExternalReferenceService references;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private IdentityTestFixture identities;

    @Test
    void whenASourceIsDescribed_thenTheLogNamesItsKeyAndNotWhatItWasCalled() {
        // when
        UUID source = source("roster-system");

        // then
        Map<String, Object> payload = audit.latestPayload(source, DataExchangeEvent.SourceDescribed.TYPE);
        assertThat(payload).containsEntry("sourceKey", "roster-system");
        assertThat(payload.toString()).doesNotContain("Membership system");
        assertEventCounts(source, Map.of(DataExchangeEvent.SourceDescribed.TYPE, 1L));
    }

    @Test
    void givenASource_whenOnlyItsThresholdChanges_thenTheLogNamesTheFieldWithoutItsValue() {
        // given
        UUID source = source("roster-system");

        // when
        change(source, "roster-system", 40);

        // then
        Map<String, Object> payload = audit.latestPayload(source, DataExchangeEvent.SourceChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("removalWarningPercent"));
        assertThat(payload.toString()).doesNotContain("40");
        assertEventCounts(source, Map.of(DataExchangeEvent.SourceDescribed.TYPE, 1L,
                DataExchangeEvent.SourceChanged.TYPE, 1L));
    }

    @Test
    void givenASource_whenAChangeAltersNothing_thenNothingIsRecorded() {
        // given
        UUID source = source("roster-system");

        // when
        change(source, "roster-system", 10);

        // then
        assertThat(audit.eventsAbout(source, DataExchangeEvent.SourceChanged.TYPE)).isEmpty();
    }

    @Test
    void givenASourceNobodyHasUsed_whenItIsDeleted_thenTheLogKeepsThatItExisted() {
        // given
        UUID source = source("roster-system");

        // when
        sources.delete(source);

        // then
        assertThat(audit.latestPayload(source, DataExchangeEvent.SourceDeleted.TYPE))
                .containsEntry("sourceKey", "roster-system");
        assertEventCounts(source, Map.of(DataExchangeEvent.SourceDescribed.TYPE, 1L,
                DataExchangeEvent.SourceDeleted.TYPE, 1L));
    }

    @Test
    void whenAMemberNumberIsLinkedToAPerson_thenTheLogSaysWhichNumberAndAgainstWhichSource() {
        // given
        UUID source = source("roster-system");
        UUID jane = identities.createPerson("Jane", "Doe");

        // when
        references.link(source, "4711", jane);

        // then — the number is the change itself, so a board can see which assignment moved
        Map<String, Object> payload =
                audit.latestPayload(jane, DataExchangeEvent.ExternalReferenceLinked.TYPE);
        assertThat(payload)
                .containsEntry("externalId", "4711")
                .containsEntry("sourceId", source.toString());
        assertThat(payload.toString()).doesNotContain("Jane").doesNotContain("Doe");
    }

    @Test
    void givenALinkedMemberNumber_whenItIsUnlinked_thenTheLogSaysSoAboutThatPerson() {
        // given
        UUID source = source("roster-system");
        UUID jane = identities.createPerson("Jane", "Doe");
        references.link(source, "4711", jane);

        // when
        references.unlink(source, "4711");

        // then
        assertThat(audit.latestPayload(jane, DataExchangeEvent.ExternalReferenceUnlinked.TYPE))
                .containsEntry("externalId", "4711");
        assertEventCounts(jane, Map.of(DataExchangeEvent.ExternalReferenceLinked.TYPE, 1L,
                DataExchangeEvent.ExternalReferenceUnlinked.TYPE, 1L));
    }

    private UUID source(String sourceKey) {
        return sources.create(sourceKey, "Membership system", ",", "UTF-8", columns(),
                Map.of(), ACTIVE_TYPE, Set.of(), 10).sourceId();
    }

    private void change(UUID sourceId, String sourceKey, int removalWarningPercent) {
        sources.change(sourceId, sourceKey, "Membership system", ",", "UTF-8", columns(),
                Map.of(), ACTIVE_TYPE, Set.of(), removalWarningPercent);
    }

    private static Map<String, CanonicalField> columns() {
        return Map.of("Member number", CanonicalField.EXTERNAL_ID,
                "First name", CanonicalField.FIRST_NAME,
                "Last name", CanonicalField.LAST_NAME);
    }

    private void assertEventCounts(UUID subjectId, Map<String, Long> expectedCounts) {
        assertThat(expectedCounts.keySet()).as("every expected count names a known event type")
                .isSubsetOf(CHANGE_EVENT_TYPES);
        Map<String, Long> actual = audit.eventCountsAbout(subjectId);
        CHANGE_EVENT_TYPES.forEach(type -> assertThat(actual.getOrDefault(type, 0L))
                .as(type)
                .isEqualTo(expectedCounts.getOrDefault(type, 0L)));
    }
}
