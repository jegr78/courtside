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
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // then
        assertThat(audit.latestPayload(type.getId(), MembershipTypeEvent.Added.TYPE))
                .containsEntry("ruleSetId", ruleSetId.toString());
        audit.assertEventCounts(type.getId(), MembershipTypeEvent.class,
                Map.of(MembershipTypeEvent.Added.TYPE, 1L));
    }

    @Test
    void givenAMembershipType_whenItsRuleSetChanges_thenTheLogCarriesTheNewRuleSet() {
        // given
        UUID other = rulesFixture.activeRuleSet("Winter");
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // when
        members.changeMembershipType(type.getId(), "Adult", other, false);

        // then
        assertThat(audit.latestPayload(type.getId(), MembershipTypeEvent.Changed.TYPE))
                .containsEntry("ruleSetId", other.toString())
                .containsEntry("changedFields", List.of());
        audit.assertEventCounts(type.getId(), MembershipTypeEvent.class,
                Map.of(MembershipTypeEvent.Added.TYPE, 1L, MembershipTypeEvent.Changed.TYPE, 1L));
    }

    @Test
    void givenAMembershipType_whenOnlyItsNameChanges_thenTheLogNamesTheFieldWithoutTheName() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // when
        members.changeMembershipType(type.getId(), "Senior", ruleSetId, false);

        // then
        Map<String, Object> payload = audit.latestPayload(type.getId(), MembershipTypeEvent.Changed.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("name"));
        assertThat(payload).doesNotContainKey("name");
        assertThat(payload.toString()).doesNotContain("Senior");
        audit.assertEventCounts(type.getId(), MembershipTypeEvent.class,
                Map.of(MembershipTypeEvent.Added.TYPE, 1L, MembershipTypeEvent.Changed.TYPE, 1L));
    }

    @Test
    void givenAMembershipType_whenItStartsGrantingAccounts_thenTheLogNamesThatField() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // when
        members.changeMembershipType(type.getId(), "Adult", ruleSetId, true);

        // then
        assertThat(audit.latestPayload(type.getId(), MembershipTypeEvent.Changed.TYPE))
                .containsEntry("changedFields", List.of("grantsAccount"));
        audit.assertEventCounts(type.getId(), MembershipTypeEvent.class,
                Map.of(MembershipTypeEvent.Added.TYPE, 1L, MembershipTypeEvent.Changed.TYPE, 1L));
    }

    @Test
    void givenAMembershipType_whenChangedWithTheStoredNameAndRuleSet_thenNothingIsRecorded() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // when
        members.changeMembershipType(type.getId(), "Adult", ruleSetId, false);

        // then
        assertThat(audit.eventsAbout(type.getId(), MembershipTypeEvent.Changed.TYPE)).isEmpty();
    }

    @Test
    void givenAnActiveMembershipType_whenItIsDeactivated_thenTheLogCarriesTheFlag() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // when
        members.setMembershipTypeActive(type.getId(), false);

        // then
        assertThat(audit.latestPayload(type.getId(), MembershipTypeEvent.AvailabilityChanged.TYPE))
                .containsEntry("active", false);
        audit.assertEventCounts(type.getId(), MembershipTypeEvent.class,
                Map.of(MembershipTypeEvent.Added.TYPE, 1L, MembershipTypeEvent.AvailabilityChanged.TYPE, 1L));
    }

    @Test
    void givenAnActiveMembershipType_whenActivatedAgain_thenNothingIsRecorded() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // when
        members.setMembershipTypeActive(type.getId(), true);

        // then
        assertThat(audit.eventsAbout(type.getId(), MembershipTypeEvent.AvailabilityChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAMembershipType_whenItIsCreated_thenTheAuditLogCanNameIt() {
        // given
        MembershipType type = members.createMembershipType("Adult", ruleSetId, false);

        // then
        assertThat(audit.nameOf(type.getId())).isEqualTo("Adult");
    }

}
