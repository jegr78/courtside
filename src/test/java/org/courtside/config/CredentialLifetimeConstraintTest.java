package org.courtside.config;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CredentialLifetimeConstraintTest extends AbstractIntegrationTest {

    @Autowired
    private JdbcClient jdbc;

    @Test
    void whenAStoredCredentialLifetimeExceedsAWeek_thenTheDatabaseRefusesItByName() {
        // when / then
        assertThatThrownBy(() -> setLifetimes(169, 24))
                .hasMessageContaining("club_config_new_account_credential_hours_range");
        assertThatThrownBy(() -> setLifetimes(168, 169))
                .hasMessageContaining("club_config_password_reset_credential_hours_range");
    }

    @Test
    void whenAStoredCredentialLifetimeIsAWeekOrLess_thenTheDatabaseAcceptsIt() {
        // when / then
        assertThatCode(() -> setLifetimes(168, 1)).doesNotThrowAnyException();
    }

    private void setLifetimes(int newAccountHours, int passwordResetHours) {
        jdbc.sql("""
                UPDATE club_config
                SET new_account_credential_hours = :newAccount,
                    password_reset_credential_hours = :passwordReset
                """)
                .param("newAccount", newAccountHours)
                .param("passwordReset", passwordResetHours)
                .update();
    }
}
