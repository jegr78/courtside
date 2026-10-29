package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.rules.internal.RuleAdminService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class BookingHorizonTest extends AbstractIntegrationTest {

    private static final UUID STANDARD_RULE_SET = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");

    @Autowired
    private BookingHorizon horizon;

    @Autowired
    private RuleAdminService rules;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenTheShippedRuleSets_whenAskingForTheHorizon_thenTheLongestAdvanceWindowAnswers() {
        // when
        var days = horizon.longestAdvanceDays();

        // then
        assertThat(days).as("the shipped standard rule set lets members book seven days ahead").hasValue(7);
    }

    @Test
    void givenADeactivatedRuleSetWithTheLongestWindow_whenAskingForTheHorizon_thenItStillCounts() {
        // given
        UUID longer = rules.createRuleSet("Long horizon").getId();
        rules.setRule(longer, RuleType.ADVANCE_WINDOW, Map.of("maxDays", 30));
        rules.setRuleSetActive(longer, false);

        // when
        var days = horizon.longestAdvanceDays();

        // then
        assertThat(days).as("a deactivated rule set still governs the members assigned to it").hasValue(30);
    }

    @Test
    void givenNoAdvanceWindowAnywhere_whenAskingForTheHorizon_thenThereIsNone() {
        // given
        jdbc.sql("DELETE FROM rule_definition WHERE rule_type = 'ADVANCE_WINDOW'").update();

        // when
        var days = horizon.longestAdvanceDays();

        // then
        assertThat(days).as("without an advance window members may book any distance ahead").isEmpty();
    }
}
