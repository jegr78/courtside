package org.courtside.identity.internal;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import lombok.RequiredArgsConstructor;
import org.courtside.identity.AccountAnonymisation;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.UserAccount;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class AccountAnonymiser implements AccountAnonymisation {

    private final EntityManager entities;
    private final JdbcClient jdbc;
    private final AccountSessions sessions;
    private final Clock clock;

    @Override
    @Transactional
    public void anonymise(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("An account to anonymise is required");
        }
        UserAccount account = entities.find(UserAccount.class, accountId, LockModeType.PESSIMISTIC_WRITE);
        if (account == null) {
            throw new IllegalStateException("No account " + accountId + " to anonymise");
        }
        sessions.endFor(account.getUsername());
        account.anonymise(clock.instant());
        account.getPerson().anonymise();
        for (String table : new String[]{"account_mfa", "mfa_recovery_code", "account_mfa_recovery", "mfa_challenge",
                "user_entities", "password_reset_token", "message_record", "notification"}) {
            jdbc.sql("DELETE FROM " + table + " WHERE account_id = :id").param("id", accountId).update();
        }
        jdbc.sql("DELETE FROM credit_entry_note n USING credit_entry e WHERE n.entry_id = e.id AND e.account_id = :id")
                .param("id", accountId).update();
        jdbc.sql("""
                        UPDATE booking_participant p SET guest_name = '' FROM booking b
                        WHERE p.booking_id = b.id AND b.booked_by = :id AND p.kind = 'GUEST'
                        """)
                .param("id", accountId).update();
        jdbc.sql("UPDATE booking SET note = NULL WHERE booked_by = :id").param("id", accountId).update();
        jdbc.sql("""
                        UPDATE waitlist_participant p SET guest_name = '' FROM waitlist_entry e
                        WHERE p.entry_id = e.id AND e.account_id = :id AND p.kind = 'GUEST'
                        """)
                .param("id", accountId).update();
        jdbc.sql("UPDATE waitlist_entry SET note = NULL WHERE account_id = :id").param("id", accountId).update();
        jdbc.sql("DELETE FROM import_external_reference WHERE person_id = :person")
                .param("person", account.getPerson().getId()).update();
    }
}
