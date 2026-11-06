package org.courtside.identity;

import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class OutsidersTest {

    private final UUID account = UUID.randomUUID();
    private final Outsiders withoutMembership = new Outsiders(accountId -> false, mock(UserAccountRepository.class));
    private final Outsiders withMembership = new Outsiders(accountId -> true, mock(UserAccountRepository.class));

    @Test
    void givenTheExternalRoleWithoutMembership_whenAskedWhetherAnOutsider_thenItIs() {
        // when / then
        assertThat(withoutMembership.isOutsider(account, Set.of(Role.EXTERNAL))).isTrue();
        assertThat(withoutMembership.isOutsider(account, Set.of(Role.EXTERNAL, Role.TRAINER)))
                .as("an office does not stand in for a membership").isTrue();
    }

    @Test
    void givenARunningMembershipOrTheAdministratorRole_whenAskedWhetherAnOutsider_thenItIsNot() {
        // when / then
        assertThat(withMembership.isOutsider(account, Set.of(Role.EXTERNAL))).as("a membership lifts the closure").isFalse();
        assertThat(withoutMembership.isOutsider(account, Set.of(Role.EXTERNAL, Role.ADMIN)))
                .as("an administrator may always book").isFalse();
        assertThat(withoutMembership.isOutsider(account, Set.of(Role.MEMBER))).isFalse();
    }
}
