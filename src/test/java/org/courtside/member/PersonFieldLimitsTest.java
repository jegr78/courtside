package org.courtside.member;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PersonFieldLimitsTest {

    @Test
    void whenJudgingAnAddress_thenOnlyOneWithADottedDomainIsUsable() {
        // when / then
        assertThat(PersonFieldLimits.isUsableEmail("jane.doe@example.org")).isTrue();
        assertThat(PersonFieldLimits.isUsableEmail("  jane.doe@example.org  ")).isTrue();
        assertThat(PersonFieldLimits.isUsableEmail("jane@localhost")).isFalse();
        assertThat(PersonFieldLimits.isUsableEmail("jane@example.")).isFalse();
        assertThat(PersonFieldLimits.isUsableEmail("@example.org")).isFalse();
        assertThat(PersonFieldLimits.isUsableEmail("jane@doe@example.org")).isFalse();
        assertThat(PersonFieldLimits.isUsableEmail("jane doe@example.org")).isFalse();
        assertThat(PersonFieldLimits.isUsableEmail("nowhere")).isFalse();
        assertThat(PersonFieldLimits.isUsableEmail(null)).isFalse();
    }

    @Test
    void whenJudgingAValue_thenAControlCharacterMakesItUnusable() {
        // when / then
        assertThat(PersonFieldLimits.isUsableName("Jane\u0000Doe")).isFalse();
        assertThat(PersonFieldLimits.isUsableName("Jane\u001fDoe")).isFalse();
        assertThat(PersonFieldLimits.isUsableName("Jane\u007fDoe")).isFalse();
        assertThat(PersonFieldLimits.isUsableEmail("jane\u0000@example.org")).isFalse();
        assertThat(PersonFieldLimits.isUsableName("Mary Jane")).isTrue();
    }

    @Test
    void whenJudgingLength_thenTheStrippedValueDecides() {
        // when / then
        assertThat(PersonFieldLimits.isUsableName("J".repeat(PersonFieldLimits.MAX_NAME_LENGTH)))
                .isTrue();
        assertThat(PersonFieldLimits.isUsableName("J".repeat(PersonFieldLimits.MAX_NAME_LENGTH + 1)))
                .isFalse();
    }
}
