package org.courtside.identity.internal;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class RecoveryAccountGuard {
    private final JdbcClient jdbc;

    void lockAndRequireAvailable(UUID account) {
        jdbc.sql("SELECT id FROM user_account WHERE id = :id FOR UPDATE")
                .param("id", account).query(UUID.class).single();
        requireAvailable(account);
    }

    void requireAvailable(UUID account) {
        if (jdbc.sql("SELECT EXISTS (SELECT 1 FROM account_mfa WHERE account_id = :id AND recovery_pending)")
                .param("id", account).query(Boolean.class).single()) throw new ResetCodeInvalidException();
    }
}
