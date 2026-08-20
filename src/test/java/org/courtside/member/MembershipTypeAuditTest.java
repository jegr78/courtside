package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.member.internal.MembershipType;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

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
        assertThat(audit.latestPayload(type.getId(), MembershipTypeEvent.Added.TYPE))
                .containsEntry("ruleSetId", ruleSetId.toString());
        assertEventCounts(type.getId(), Map.of(MembershipTypeEvent.Added.TYPE, 1));
    }

    @Test
    void givenAMembershipType_whenItsRuleSetChanges_thenTheLogCarriesTheNewRuleSet() {
        // given
        UUID other = rulesFixture.activeRuleSet("Winter");
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.changeMembershipType(type.getId(), "Adult", other);

        // then
        assertThat(audit.latestPayload(type.getId(), MembershipTypeEvent.Changed.TYPE))
                .containsEntry("ruleSetId", other.toString())
                .containsEntry("changedFields", List.of());
        assertEventCounts(type.getId(),
                Map.of(MembershipTypeEvent.Added.TYPE, 1, MembershipTypeEvent.Changed.TYPE, 1));
    }

    @Test
    void givenAMembershipType_whenOnlyItsNameChanges_thenTheLogNamesTheFieldWithoutTheName() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.changeMembershipType(type.getId(), "Senior", ruleSetId);

        // then
        Map<String, Object> payload = audit.latestPayload(type.getId(), MembershipTypeEvent.Changed.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("name"));
        assertThat(payload).doesNotContainKey("name");
        assertThat(payload.toString()).doesNotContain("Senior");
        assertEventCounts(type.getId(),
                Map.of(MembershipTypeEvent.Added.TYPE, 1, MembershipTypeEvent.Changed.TYPE, 1));
    }

    @Test
    void givenAMembershipType_whenChangedWithTheStoredNameAndRuleSet_thenNothingIsRecorded() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.changeMembershipType(type.getId(), "Adult", ruleSetId);

        // then
        assertThat(audit.eventsAbout(type.getId(), MembershipTypeEvent.Changed.TYPE)).isEmpty();
    }

    @Test
    void givenAnActiveMembershipType_whenItIsDeactivated_thenTheLogCarriesTheFlag() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.setMembershipTypeActive(type.getId(), false);

        // then
        assertThat(audit.latestPayload(type.getId(), MembershipTypeEvent.AvailabilityChanged.TYPE))
                .containsEntry("active", false);
        assertEventCounts(type.getId(),
                Map.of(MembershipTypeEvent.Added.TYPE, 1, MembershipTypeEvent.AvailabilityChanged.TYPE, 1));
    }

    @Test
    void givenAnActiveMembershipType_whenActivatedAgain_thenNothingIsRecorded() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId);

        // when
        members.setMembershipTypeActive(type.getId(), true);

        // then
        assertThat(audit.eventsAbout(type.getId(), MembershipTypeEvent.AvailabilityChanged.TYPE)).isEmpty();
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

    private void assertEventCounts(UUID membershipTypeId, Map<String, Integer> expectedCounts) {
        Map<String, Long> actual = audit.eventCountsAbout(membershipTypeId);
        CHANGE_EVENT_TYPES.forEach(type -> assertThat(actual.getOrDefault(type, 0L))
                .as(type)
                .isEqualTo(expectedCounts.getOrDefault(type, 0).longValue()));
    }
}
