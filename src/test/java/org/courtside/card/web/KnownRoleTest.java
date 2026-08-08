package org.courtside.card.web;

import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

class KnownRoleTest {

    private final KnownRole.Validator validator = new KnownRole.Validator();

    @Test
    void whenValidatingEveryRoleTheInstanceKnows_thenEachIsAccepted() {
        // when / then
        assertThat(Arrays.stream(Role.values()).map(Enum::name))
                .allSatisfy(name -> assertThat(validator.isValid(name, null))
                        .as("Role.%s is a role the enum declares, so the card boundary must "
                                + "accept it", name)
                        .isTrue());
    }

    @Test
    void whenValidatingANameNoRoleCarries_thenItIsRejected() {
        // when / then
        assertThat(validator.isValid("PRESIDENT", null)).isFalse();
    }

    @Test
    void whenValidatingARoleNameInTheWrongCase_thenItIsRejected() {
        // when / then
        assertThat(validator.isValid("member", null)).isFalse();
    }

    @Test
    void whenValidatingAnAuthorityRatherThanARoleName_thenItIsRejected() {
        // given — Spring Security grants "ROLE_MEMBER"; the wire contract carries "MEMBER"
        // when / then
        assertThat(validator.isValid("ROLE_MEMBER", null)).isFalse();
    }

    @Test
    void whenValidatingNoRoleAtAll_thenItIsAccepted() {
        // given — requiredRole is optional: a card without one is open to every member
        // when / then
        assertThat(validator.isValid(null, null)).isTrue();
    }

    @Test
    void whenValidatingTheEmptyName_thenItIsRejected() {
        // when / then
        assertThat(validator.isValid("", null)).isFalse();
    }
}
