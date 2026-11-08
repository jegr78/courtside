package org.courtside.credit.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.HeldCredit;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Component
@RequiredArgsConstructor
class LedgerBalances implements HeldCredit {

    private final JdbcClient jdbc;

    @Override
    @Transactional(readOnly = true)
    public boolean heldBy(UUID accountId) {
        return accountId != null && jdbc.sql("""
                        SELECT EXISTS (SELECT 1 FROM credit_entry WHERE account_id = :account
                                       GROUP BY currency HAVING sum(amount_minor) <> 0)
                        """)
                .param("account", accountId).query(Boolean.class).single();
    }

    @Override
    @Transactional(readOnly = true)
    public boolean heldByAnyone() {
        return jdbc.sql("""
                        SELECT EXISTS (SELECT 1 FROM credit_entry
                                       GROUP BY account_id, currency HAVING sum(amount_minor) <> 0)
                        """)
                .query(Boolean.class).single();
    }
}
