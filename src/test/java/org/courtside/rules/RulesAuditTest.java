package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.rules.internal.RuleAdminService;
import org.courtside.rules.internal.RuleParameterInvalidException;
import org.courtside.rules.internal.RuleSet;
import org.courtside.rules.internal.RuleType;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.ArrayList;
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
        assertThat(payloadOf(ruleSet.getId(), RulesEvent.RuleSetAdded.TYPE))
                .containsEntry("ruleSetId", ruleSet.getId().toString());
        assertSiblingsSilent(ruleSet.getId(), RulesEvent.RuleSetAdded.TYPE);
    }

    @Test
    void givenARuleSet_whenItIsRenamed_thenTheLogNamesTheFieldWithoutTheValue() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.changeRuleSet(ruleSet.getId(), "Winter");

        // then
        Map<String, Object> payload = payloadOf(ruleSet.getId(), RulesEvent.RuleSetChanged.TYPE);
        assertThat(payload).containsEntry("changedFields", List.of("name"));
        assertThat(payload).doesNotContainKey("name");
        assertThat(payload.toString()).doesNotContain("Winter");
        assertSiblingsSilent(ruleSet.getId(), RulesEvent.RuleSetChanged.TYPE);
    }

    @Test
    void givenARuleSet_whenRenamedWithTheStoredName_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.changeRuleSet(ruleSet.getId(), "Summer");

        // then
        assertThat(eventsOfTypeAbout(ruleSet.getId(), RulesEvent.RuleSetChanged.TYPE)).isEmpty();
    }

    @Test
    void givenAnActiveRuleSet_whenItIsDeactivated_thenTheLogCarriesTheFlag() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.setRuleSetActive(ruleSet.getId(), false);

        // then
        assertThat(payloadOf(ruleSet.getId(), RulesEvent.RuleSetAvailabilityChanged.TYPE))
                .containsEntry("active", false);
        assertSiblingsSilent(ruleSet.getId(), RulesEvent.RuleSetAvailabilityChanged.TYPE);
    }

    @Test
    void givenAnActiveRuleSet_whenActivatedAgain_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.setRuleSetActive(ruleSet.getId(), true);

        // then
        assertThat(eventsOfTypeAbout(ruleSet.getId(), RulesEvent.RuleSetAvailabilityChanged.TYPE)).isEmpty();
    }

    @Test
    void givenARuleSet_whenARuleIsSet_thenTheLogCarriesTheParameters() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // then
        assertThat(payloadOf(ruleSet.getId(), RulesEvent.RuleDefinitionSet.TYPE))
                .containsEntry("ruleType", "MAX_OPEN_BOOKINGS")
                .extracting("params").isEqualTo(Map.of("limit", 2));
        assertSiblingsSilent(ruleSet.getId(), RulesEvent.RuleDefinitionSet.TYPE);
    }

    @Test
    void givenARuleAlreadySetToItsParameters_whenSetAgainWithTheSameParameters_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // when
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // then
        assertThat(eventsOfTypeAbout(ruleSet.getId(), RulesEvent.RuleDefinitionSet.TYPE)).hasSize(1);
    }

    @Test
    void givenAnOutOfBoundsParameter_whenARuleIsSet_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when / then
        assertThatThrownBy(() -> rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 100)))
                .isInstanceOf(RuleParameterInvalidException.class);
        assertThat(eventsOfTypeAbout(ruleSet.getId(), RulesEvent.RuleDefinitionSet.TYPE)).isEmpty();
    }

    @Test
    void givenARuleSetRule_whenItIsRemoved_thenTheLogCarriesTheRuleType() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");
        rules.setRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS, Map.of("limit", 2));

        // when
        rules.removeRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS);

        // then
        assertThat(payloadOf(ruleSet.getId(), RulesEvent.RuleDefinitionRemoved.TYPE))
                .containsEntry("ruleType", "MAX_OPEN_BOOKINGS");
        assertSiblingsSilent(ruleSet.getId(), RulesEvent.RuleDefinitionRemoved.TYPE, RulesEvent.RuleDefinitionSet.TYPE);
    }

    @Test
    void givenNoSuchRule_whenItIsRemoved_thenNothingIsRecorded() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // when
        rules.removeRule(ruleSet.getId(), RuleType.MAX_OPEN_BOOKINGS);

        // then
        assertThat(eventsOfTypeAbout(ruleSet.getId(), RulesEvent.RuleDefinitionRemoved.TYPE)).isEmpty();
    }

    @Test
    void givenARuleSet_whenItIsCreated_thenTheAuditLogCanNameIt() {
        // given
        RuleSet ruleSet = rules.createRuleSet("Summer");

        // then
        assertThat(audit.nameOf(ruleSet.getId())).isEqualTo("Summer");
    }

    private static final List<String> CHANGE_EVENT_TYPES = List.of(RulesEvent.RuleSetChanged.TYPE,
            RulesEvent.RuleSetAvailabilityChanged.TYPE, RulesEvent.RuleDefinitionSet.TYPE,
            RulesEvent.RuleDefinitionRemoved.TYPE);

    private void assertSiblingsSilent(UUID ruleSetId, String publishedType, String... alreadyExpectedTypes) {
        List<String> excluded = new ArrayList<>(List.of(alreadyExpectedTypes));
        excluded.add(publishedType);
        CHANGE_EVENT_TYPES.stream()
                .filter(type -> !excluded.contains(type))
                .forEach(type -> assertThat(eventsOfTypeAbout(ruleSetId, type)).as(type).isEmpty());
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
