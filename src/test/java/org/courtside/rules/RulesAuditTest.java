package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.DomainEventTypes;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.rules.internal.RuleParameterInvalidException;
import org.courtside.rules.internal.RuleSet;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(AuditTestFixture.class)
class RulesAuditTest extends AbstractIntegrationTest {

    @Autowired
    private RuleAdminService rules;

    @Autowired
    private AuditTestFixture audit;

    @Test
    void givenARuleSetName_whenItIsCreated_thenTheLogCarriesItsId() {
        // when
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // then
        assertThat(audit.latestPayload(ruleSet.getId(), RulesEvent.RuleSetAdded.TYPE))
                .containsEntry("ruleSetId", ruleSet.getId().toString());
        assertEventCounts(ruleSet.getId(), Map.of(RulesEvent.RuleSetAdded.TYPE, 1L));
    }

    @Test
    void givenARuleSet_whenItIsRenamed_thenTheLogNamesTheFieldWithoutTheValue() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.changeRuleSet(ruleSet.getId(), "Winter");

        // then
        Map<String, Object> payload = audit.latestPayload(ruleSet.getId(), RulesEvent.RuleSetChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("name"));
        assertThat(payload).doesNotContainKey("name");
        assertThat(payload.toString()).doesNotContain("Winter");
        assertEventCounts(ruleSet.getId(),
                Map.of(RulesEvent.RuleSetAdded.TYPE, 1L, RulesEvent.RuleSetChanged.TYPE, 1L));
    }

    @Test
    void givenARuleSet_whenRenamedWithTheStoredName_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.changeRuleSet(ruleSet.getId(), "Summer");

        // then
        assertThat(audit.eventsAbout(ruleSet.getId(), RulesEvent.RuleSetChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAnActiveRuleSet_whenItIsDeactivated_thenTheLogCarriesTheFlag() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.setRuleSetActive(ruleSet.getId(), false);

        // then
        assertThat(audit.latestPayload(ruleSet.getId(), RulesEvent.RuleSetAvailabilityChanged.TYPE))
                .containsEntry("active", false);
        assertEventCounts(ruleSet.getId(),
                Map.of(RulesEvent.RuleSetAdded.TYPE, 1L, RulesEvent.RuleSetAvailabilityChanged.TYPE, 1L));
    }

    @Test
    void givenAnActiveRuleSet_whenActivatedAgain_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.setRuleSetActive(ruleSet.getId(), true);

        // then
        assertThat(audit.eventsAbout(ruleSet.getId(), RulesEvent.RuleSetAvailabilityChanged.TYPE)).isEmpty();
    }

    @Test
    void givenARuleSet_whenARuleIsSet_thenTheLogCarriesTheParameters() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // then
        assertThat(audit.latestPayload(ruleSet.getId(), RulesEvent.RuleDefinitionSet.TYPE))
                .containsEntry("ruleType", "MAX_OPEN_BOOKINGS")
                .extracting("params").isEqualTo(Map.of("limit", 2));
        assertEventCounts(ruleSet.getId(),
                Map.of(RulesEvent.RuleSetAdded.TYPE, 1L, RulesEvent.RuleDefinitionSet.TYPE, 1L));
    }

    @Test
    void givenARuleAlreadySetToItsParameters_whenSetAgainWithTheSameParameters_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // when
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // then
        assertThat(audit.eventsAbout(ruleSet.getId(), RulesEvent.RuleDefinitionSet.TYPE)).hasSize(1);
    }

    @Test
    void givenAnOutOfBoundsParameter_whenARuleIsSet_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when / then
        assertThatThrownBy(() -> rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 100)))
                .isInstanceOf(RuleParameterInvalidException.class);
        assertThat(audit.eventsAbout(ruleSet.getId(), RulesEvent.RuleDefinitionSet.TYPE)).isEmpty();
    }

    @Test
    void givenARuleSetRule_whenItIsRemoved_thenTheLogCarriesTheRuleType() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // when
        rules.removeRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS);

        // then
        assertThat(audit.latestPayload(ruleSet.getId(), RulesEvent.RuleDefinitionRemoved.TYPE))
                .containsEntry("ruleType", "MAX_OPEN_BOOKINGS");
        assertEventCounts(ruleSet.getId(), Map.of(
                RulesEvent.RuleSetAdded.TYPE, 1L,
                RulesEvent.RuleDefinitionSet.TYPE, 1L,
                RulesEvent.RuleDefinitionRemoved.TYPE, 1L));
    }

    @Test
    void givenNoSuchRule_whenItIsRemoved_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.removeRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS);

        // then
        assertThat(audit.eventsAbout(ruleSet.getId(), RulesEvent.RuleDefinitionRemoved.TYPE)).isEmpty();
    }

    @Test
    void givenARuleSet_whenItIsCreated_thenTheAuditLogCanNameIt() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // then
        assertThat(audit.nameOf(ruleSet.getId())).isEqualTo("Summer");
    }

    private static final List<String> CHANGE_EVENT_TYPES = DomainEventTypes.typesOf(RulesEvent.class);

    private void assertEventCounts(UUID ruleSetId, Map<String, Long> expectedCounts) {
        assertThat(expectedCounts.keySet()).as("every expected count names a known event type")
                .isSubsetOf(CHANGE_EVENT_TYPES);
        Map<String, Long> actual = audit.eventCountsAbout(ruleSetId);
        CHANGE_EVENT_TYPES.forEach(type -> assertThat(actual.getOrDefault(type, 0L))
                .as(type)
                .isEqualTo(expectedCounts.getOrDefault(type, 0L)));
    }
}
