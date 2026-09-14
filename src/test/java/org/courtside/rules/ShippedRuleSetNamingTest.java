package org.courtside.rules;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({ConfigTestFixture.class, RulesTestFixture.class})
class ShippedRuleSetNamingTest extends AbstractIntegrationTest {

    private static final UUID STANDARD = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID YOUTH = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");

    @Autowired
    private ConfigTestFixture configuration;

    @Autowired
    private RulesTestFixture rules;

    @Test
    void whenTheInstanceHasStarted_thenItsRuleSetsCarryTheLanguageTheClubIsShippedWith() {
        // when / then
        assertThat(nameOf(YOUTH)).isEqualTo("Jugend");
        assertThat(nameOf(STANDARD)).isEqualTo("Standard");
    }

    @Test
    void givenAClubThatChangesItsLanguage_whenItIsSaved_thenItsRuleSetsFollowWithoutARestart() {
        // when
        configuration.speak("en");

        // then
        assertThat(nameOf(YOUTH)).isEqualTo("Youth");
    }

    @Test
    void givenARuleSetTheClubNamedItself_whenTheClubChangesItsLanguage_thenTheClubsOwnNameStands() {
        // given
        rules.renameRuleSet(YOUTH, "Under 18");

        // when
        configuration.speak("en");

        // then
        assertThat(nameOf(YOUTH)).isEqualTo("Under 18");
    }

    private String nameOf(UUID ruleSetId) {
        return rules.ruleSetName(ruleSetId);
    }
}
