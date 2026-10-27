package org.courtside.identity;

import org.junit.jupiter.api.Test;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AccountSecurityMaintenanceTest {
    @Test
    void givenARecoveryCommand_whenParsed_thenItNamesOneAccountAndRequiresConfirmedIdentity() {
        // given
        UUID account = UUID.randomUUID();
        // when
        var command = AccountSecurityMaintenance.command(new String[]{
                "--courtside.maintenance.action=mfa-recover", "--courtside.maintenance.account-id=" + account,
                "--courtside.maintenance.identity-checked=true"});
        // then
        assertThat(command.account()).isEqualTo(account);
        assertThat(command.identityChecked()).isTrue();
        assertThatThrownBy(() -> AccountSecurityMaintenance.command(new String[]{
                "--courtside.maintenance.action=mfa-recover", "--courtside.maintenance.account-id=" + account}))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("identity-checked=true");
    }

    @Test
    void givenMissingOrMalformedArguments_whenParsed_thenTheErrorContainsNoInput() {
        // given / when / then
        assertThatThrownBy(() -> AccountSecurityMaintenance.command(new String[]{
                "--courtside.maintenance.action=mfa-correct-email", "--courtside.maintenance.account-id=private-value",
                "--courtside.maintenance.email=jane.doe@example.org", "--courtside.maintenance.identity-checked=true"}))
                .isInstanceOf(IllegalStateException.class).hasMessageNotContaining("private-value").hasMessageNotContaining("jane.doe@example.org");
        assertThat(AccountSecurityMaintenance.requested(new String[]{"--courtside.maintenance.action=mfa-rotate-keys"})).isTrue();
        assertThat(AccountSecurityMaintenance.requested(new String[]{})).isFalse();
    }
}
