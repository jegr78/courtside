package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.payment.internal.PayPalRefunds.RefundStatus;
import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Currency;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class PayPalRefundStore {

    private static final String COLUMNS = """
            SELECT id, order_id, account_id, amount_minor, currency, status, refund_id, failure_reason
            FROM paypal_refund
            """;
    private static final RowMapper<StoredRefund> ROW = (rs, n) -> new StoredRefund(rs.getObject(1, UUID.class),
            rs.getString(2), rs.getObject(3, UUID.class), rs.getInt(4), Currency.getInstance(rs.getString(5)),
            RefundStatus.valueOf(rs.getString(6)), rs.getString(7), rs.getString(8));

    private final JdbcClient jdbc;
    private final Clock clock;

    void insert(StoredRefund refund, UUID requestedBy) {
        Timestamp now = Timestamp.from(clock.instant());
        jdbc.sql("""
                        INSERT INTO paypal_refund (id, order_id, account_id, amount_minor, currency, status,
                                                   requested_by, requested_at, updated_at)
                        VALUES (:id, :order, :account, :amount, :currency, :status, :by, :now, :now)
                        """)
                .param("id", refund.id()).param("order", refund.orderId()).param("account", refund.accountId())
                .param("amount", refund.amountMinor()).param("currency", refund.currency().getCurrencyCode())
                .param("status", refund.status().name()).param("by", requestedBy).param("now", now).update();
    }

    Optional<StoredRefund> find(UUID id) {
        return jdbc.sql(COLUMNS + "WHERE id = :id").param("id", id).query(ROW).optional();
    }

    Optional<StoredRefund> ofOrder(String orderId) {
        return jdbc.sql(COLUMNS + "WHERE order_id = :order").param("order", orderId).query(ROW).optional();
    }

    /** Pending refunds requested before the given instant, the longest unchecked first. */
    List<UUID> pendingSince(Instant before, int limit) {
        return jdbc.sql("""
                        SELECT id FROM paypal_refund WHERE status = 'PENDING' AND requested_at <= :before
                        ORDER BY updated_at, id LIMIT :limit
                        """)
                .param("before", Timestamp.from(before)).param("limit", limit).query(UUID.class).list();
    }

    void pending(UUID id, String refundId) {
        update(id, RefundStatus.PENDING, refundId, null);
    }

    void completed(UUID id, String refundId) {
        update(id, RefundStatus.COMPLETED, refundId, null);
    }

    void failed(UUID id, @Nullable String refundId, String reason) {
        update(id, RefundStatus.FAILED, refundId, reason);
    }

    private void update(UUID id, RefundStatus status, @Nullable String refundId, @Nullable String reason) {
        jdbc.sql("""
                        UPDATE paypal_refund
                        SET status = :status, refund_id = coalesce(CAST(:refund AS text), refund_id),
                            failure_reason = CAST(:reason AS text), updated_at = :now
                        WHERE id = :id AND status = 'PENDING'
                        """)
                .param("id", id).param("status", status.name()).param("refund", refundId).param("reason", reason)
                .param("now", Timestamp.from(clock.instant())).update();
    }

    record StoredRefund(UUID id, String orderId, UUID accountId, int amountMinor, Currency currency,
                        RefundStatus status, @Nullable String refundId, @Nullable String failureReason) {
    }
}
