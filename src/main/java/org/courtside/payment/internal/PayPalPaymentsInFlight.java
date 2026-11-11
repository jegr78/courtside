package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.PaymentsInFlight;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Component
@RequiredArgsConstructor
class PayPalPaymentsInFlight implements PaymentsInFlight {

    private final JdbcClient jdbc;

    @Override
    @Transactional(readOnly = true)
    public MoneyHeld moneyHeldBy(UUID accountId) {
        if (accountId == null) {
            throw new IllegalStateException("Money is held by an account");
        }
        return jdbc.sql("""
                        SELECT EXISTS (SELECT 1 FROM credit_entry WHERE account_id = :account
                                       GROUP BY currency HAVING sum(amount_minor) <> 0) AS credit,
                               EXISTS (SELECT 1 FROM paypal_refund WHERE account_id = :account AND status = 'PENDING')
                               OR EXISTS (SELECT 1 FROM paypal_order WHERE account_id = :account
                                          AND status = 'CREATED') AS payment
                        """)
                .param("account", accountId)
                .query((rs, row) -> new MoneyHeld(rs.getBoolean("credit"), rs.getBoolean("payment"))).single();
    }
}
