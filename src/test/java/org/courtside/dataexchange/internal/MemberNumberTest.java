package org.courtside.dataexchange.internal;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MemberNumberTest {

    @Test
    void givenAMemberNumberWithPadding_whenItIsRead_thenItCarriesTheStrippedValue() {
        // when / then
        assertThat(new MemberNumber("  4711  ").value()).isEqualTo("4711");
    }

    @Test
    void givenAMemberNumberLongerThanTheColumnAllows_whenItIsRead_thenItIsRefused() {
        // given
        String tooLong = "4".repeat(MemberNumber.MAX_LENGTH + 1);

        // when / then
        assertThatThrownBy(() -> new MemberNumber(tooLong))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void givenAMemberNumberThatSaysNothing_whenItIsRead_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> new MemberNumber("   ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new MemberNumber(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new MemberNumber("47\n11")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenAskingWhetherAValueIsUsable_thenItAnswersForEveryShapeTheConstructorRefuses() {
        // when / then
        assertThat(MemberNumber.isUsable("4711")).isTrue();
        assertThat(MemberNumber.isUsable("  4711  ")).isTrue();
        assertThat(MemberNumber.isUsable(null)).isFalse();
        assertThat(MemberNumber.isUsable("   ")).isFalse();
        assertThat(MemberNumber.isUsable("47\r11")).isFalse();
        assertThat(MemberNumber.isUsable("4".repeat(MemberNumber.MAX_LENGTH + 1))).isFalse();
    }
}
