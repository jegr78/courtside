package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.Clock;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class MfaTotpRepositoryTest extends AbstractIntegrationTest {
    @Autowired private MfaTotpRepository totp;
    @Autowired private JdbcClient jdbc;
    @Autowired private Clock clock;

    @Test
    void givenAnUnconfirmedEnrollment_whenTheHolderConfirms_thenItActivatesWithoutStoringPlaintext() {
        // given
        UUID account = account();
        byte[] secret = totp.begin(account);
        // then
        assertThat(totp.enabled(account)).isFalse();
        assertThat(totp.verify(account, TotpCodes.code(secret, clock.instant()))).isFalse();
        // when
        boolean confirmed = totp.confirm(account, TotpCodes.code(secret, clock.instant()));
        // then
        assertThat(confirmed).isTrue();
        assertThat(totp.enabled(account)).isTrue();
        assertThat(jdbc.sql("SELECT totp_secret FROM account_mfa WHERE account_id = :id")
                .param("id", account).query(String.class).single()).doesNotContain(TotpCodes.encodeSecret(secret));
        assertThat(totp.verify(account, TotpCodes.code(secret, clock.instant()))).isFalse();
        assertThat(totp.verify(account, TotpCodes.code(secret, clock.instant().plusSeconds(30)))).isTrue();
        assertThat(totp.verify(account, TotpCodes.code(secret, clock.instant().plusSeconds(30)))).isFalse();
    }

    @Test
    void givenAnExpiredOrInvalidEnrollment_whenConfirming_thenItCannotBecomeAnActiveFactor() {
        // given
        UUID account = account();
        byte[] secret = totp.begin(account);
        // when / then
        assertThat(totp.confirm(account, "malformed")).isFalse();
        jdbc.sql("UPDATE account_mfa SET pending_totp_expires_at = :expired WHERE account_id = :id")
                .param("id", account).param("expired", clock.instant().atOffset(java.time.ZoneOffset.UTC)).update();
        assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant()))).isFalse();
        assertThat(totp.enabled(account)).isFalse();
    }

    @Test
    void givenAnActiveFactor_whenAnotherSetupIsAbandoned_thenTheOriginalFactorStillWorks() {
        // given
        UUID account = account();
        byte[] original = totp.begin(account);
        assertThat(totp.confirm(account, TotpCodes.code(original, clock.instant().minusSeconds(30)))).isTrue();
        // when
        byte[] replacement = totp.begin(account);
        // then
        assertThat(replacement).isNotEqualTo(original);
        assertThat(totp.verify(account, TotpCodes.code(original, clock.instant()))).isTrue();
        // when
        totp.remove(account);
        // then
        assertThat(totp.enabled(account)).isFalse();
        assertThat(totp.confirm(account, TotpCodes.code(replacement, clock.instant()))).isFalse();
    }

    private UUID account() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (:id, 'Jane', 'Doe', :email)")
                .param("id", id).param("email", id + "@example.org").update();
        jdbc.sql("""
                INSERT INTO user_account (id, person_id, username, locale, enabled, password_change_required)
                VALUES (:id, :id, :username, 'en', true, true)
                """).param("id", id).param("username", "mfa." + id).update();
        return id;
    }
}
