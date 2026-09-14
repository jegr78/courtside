package org.courtside.rules.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.ShippedNames;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;

@Import({ConfigTestFixture.class, RulesTestFixture.class})
class ShippedRuleSetNamingStartupTest extends AbstractIntegrationTest {

    private static final UUID YOUTH = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");

    @Autowired
    private ShippedRuleSetNaming naming;

    @Autowired
    private RulesTestFixture rules;

    @Autowired
    private ConfigTestFixture configuration;

    @MockitoSpyBean
    private ShippedNames names;

    @Test
    void givenAClubUsingTheNameAShippedRuleSetWouldTake_whenTheInstanceStarts_thenItStartsAnyway() {
        // given — both languages call the standard set the same, so the youth set is the collision
        rules.activeRuleSet("Youth");
        configuration.speak("en");

        // when / then — a runner that throws closes the context, and a club could not start again
        assertThatNoException().isThrownBy(() -> naming.run(null));
        assertThat(rules.ruleSetName(YOUTH)).isEqualTo("Jugend");
    }

    @Test
    void givenANameNoRowMayCarry_whenTheInstanceStarts_thenItIsNotReportedAsANameInUse() {
        // given — only a bundle this image ships broken names a row this way, and the row stays
        // recognisable because everyLanguage reads the same bundle the stub would otherwise blank
        doReturn(names.everyLanguage("ruleSet.youth")).when(names).everyLanguage("ruleSet.youth");
        doReturn(" ").when(names).in("ruleSet.youth", "de");

        // when / then
        assertThatThrownBy(() -> naming.run(null))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
