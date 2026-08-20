package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.member.internal.MembershipType;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({AuditTestFixture.class, RulesTestFixture.class})
class MembershipTypeAuditTest extends AbstractIntegrationTest {

    @Autowired
    private MemberService members;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private RulesTestFixture rulesFixture;

    private UUID ruleSetId;

    @BeforeEach
    void givenAnActiveRuleSet() {
        ruleSetId = rulesFixture.activeRuleSet("Summer");
    }

    @Test
    void givenAMembershipTypeName_whenItIsCreated_thenTheLogCarriesItsRuleSet() {
        // when
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // then
        assertThat(payloadOf(type.getId(), MembershipTypeEvent.Added.TYPE))
                .containsEntry("ruleSetId", ruleSetId.toString());
        assertSiblingsSilent(type.getId(), MembershipTypeEvent.Added.TYPE);
    }

    @Test
    void givenAMembershipType_whenItsRuleSetChanges_thenTheLogCarriesTheNewRuleSet() {
        // given
        UUID other = rulesFixture.activeRuleSet("Winter");
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.changeMembershipType(type.getId(), "Adult", other);

        // then
        assertThat(payloadOf(type.getId(), MembershipTypeEvent.Changed.TYPE))
                .containsEntry("ruleSetId", other.toString())
                .containsEntry("changedFields", List.of());
        assertSiblingsSilent(type.getId(), MembershipTypeEvent.Changed.TYPE, MembershipTypeEvent.Added.TYPE);
    }

    @Test
    void givenAMembershipType_whenOnlyItsNameChanges_thenTheLogNamesTheFieldWithoutTheName() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.changeMembershipType(type.getId(), "Senior", ruleSetId);

        // then
        Map<String, Object> payload = payloadOf(type.getId(), MembershipTypeEvent.Changed.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("name"));
        assertThat(payload).doesNotContainKey("name");
        assertThat(payload.toString()).doesNotContain("Senior");
        assertSiblingsSilent(type.getId(), MembershipTypeEvent.Changed.TYPE, MembershipTypeEvent.Added.TYPE);
    }

    @Test
    void givenAMembershipType_whenChangedWithTheStoredNameAndRuleSet_thenNothingIsRecorded() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.changeMembershipType(type.getId(), "Adult", ruleSetId);

        // then
        assertThat(eventsOfTypeAbout(type.getId(), MembershipTypeEvent.Changed.TYPE)).isEmpty();
    }

    @Test
    void givenAnActiveMembershipType_whenItIsDeactivated_thenTheLogCarriesTheFlag() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.setMembershipTypeActive(type.getId(), false);

        // then
        assertThat(payloadOf(type.getId(), MembershipTypeEvent.AvailabilityChanged.TYPE))
                .containsEntry("active", false);
        assertSiblingsSilent(type.getId(), MembershipTypeEvent.AvailabilityChanged.TYPE, MembershipTypeEvent.Added.TYPE);
    }

    @Test
    void givenAnActiveMembershipType_whenActivatedAgain_thenNothingIsRecorded() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.setMembershipTypeActive(type.getId(), true);

        // then
        assertThat(eventsOfTypeAbout(type.getId(), MembershipTypeEvent.AvailabilityChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAMembershipType_whenItIsCreated_thenTheAuditLogCanNameIt() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // then
        assertThat(audit.nameOf(type.getId())).isEqualTo("Adult");
    }

    private static final List<String> CHANGE_EVENT_TYPES = List.of(MembershipTypeEvent.Added.TYPE,
            MembershipTypeEvent.Changed.TYPE, MembershipTypeEvent.AvailabilityChanged.TYPE);

    private void assertSiblingsSilent(UUID membershipTypeId, String publishedType, String... alreadyExpectedTypes) {
        List<String> excluded = new ArrayList<>(List.of(alreadyExpectedTypes));
        excluded.add(publishedType);
        CHANGE_EVENT_TYPES.stream()
                .filter(type -> !excluded.contains(type))
                .forEach(type -> assertThat(eventsOfTypeAbout(membershipTypeId, type)).as(type).isEmpty());
    }

    private Map<String, Object> payloadOf(UUID subjectId, String eventType) {
        return eventsOfTypeAbout(subjectId, eventType).stream()
                .reduce((first, second) -> second)
                .map(RecordedEvent::payload)
                .orElseThrow();
    }

    private List<RecordedEvent> eventsOfTypeAbout(UUID subjectId, String eventType) {
        return audit.eventsAbout(subjectId).stream()
                .filter(event -> event.eventType().equals(eventType))
                .toList();
    }
}
