package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.payment.PayPalEnvironment;
import org.jspecify.annotations.Nullable;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Currency;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
class PayPalOrders {

    private static final String COLUMNS = """
            SELECT order_id, booking_id, account_id, environment, amount_minor, currency, status, approve_url,
                   capture_attempted_at
            FROM paypal_order
            """;
    private static final RowMapper<StoredOrder> ROW = (rs, n) -> new StoredOrder(rs.getString(1),
            rs.getObject(2, UUID.class), rs.getObject(3, UUID.class), PayPalEnvironment.valueOf(rs.getString(4)),
            rs.getInt(5), Currency.getInstance(rs.getString(6)), Status.valueOf(rs.getString(7)),
            URI.create(rs.getString(8)), rs.getTimestamp(9) == null ? null : rs.getTimestamp(9).toInstant());

    private final JdbcClient jdbc;
    private final Clock clock;

    /** Stores a new order; false when the booking or the order id already has one. */
    boolean insert(StoredOrder order) {
        Timestamp now = Timestamp.from(clock.instant());
        return jdbc.sql("""
                        INSERT INTO paypal_order (order_id, booking_id, account_id, environment, amount_minor, currency,
                                                  status, approve_url, created_at, updated_at)
                        VALUES (:order, :booking, :account, :environment, :amount, :currency, :status, :approve,
                                :now, :now)
                        ON CONFLICT DO NOTHING
                        """)
                .param("order", order.orderId()).param("booking", order.bookingId())
                .param("account", order.accountId()).param("environment", order.environment().name())
                .param("amount", order.amountMinor()).param("currency", order.currency().getCurrencyCode())
                .param("status", order.status().name()).param("approve", order.approveUrl().toString())
                .param("now", now).update() == 1;
    }

    Optional<StoredOrder> find(String orderId) {
        return jdbc.sql(COLUMNS + "WHERE order_id = :order").param("order", orderId).query(ROW).optional();
    }

    Optional<StoredOrder> ofBooking(UUID bookingId) {
        return jdbc.sql(COLUMNS + "WHERE booking_id = :booking").param("booking", bookingId).query(ROW).optional();
    }

    /** Reads the order and holds its row until the caller's transaction ends. */
    Optional<StoredOrder> lock(String orderId) {
        return jdbc.sql(COLUMNS + "WHERE order_id = :order FOR UPDATE").param("order", orderId).query(ROW)
                .optional();
    }

    List<StoredOrder> open(PayPalEnvironment environment) {
        return jdbc.sql(COLUMNS + "WHERE status = 'CREATED' AND environment = :environment ORDER BY created_at")
                .param("environment", environment.name()).query(ROW).list();
    }

    /** Open orders created before the given instant, the longest unchecked first. */
    List<String> openSince(Instant createdBefore, int limit) {
        return jdbc.sql("""
                        SELECT order_id FROM paypal_order WHERE status = 'CREATED' AND created_at <= :before
                        ORDER BY updated_at, order_id LIMIT :limit
                        """)
                .param("before", Timestamp.from(createdBefore)).param("limit", limit).query(String.class).list();
    }

    /** Voided orders whose capture was attempted after the first instant and not checked since the second. */
    List<String> voidedAfterCaptureAttempt(Instant attemptedAfter, Instant checkedBefore, int limit) {
        return jdbc.sql("""
                        SELECT order_id FROM paypal_order
                        WHERE status = 'VOIDED' AND capture_attempted_at > :attempted AND updated_at <= :checked
                        ORDER BY updated_at, order_id LIMIT :limit
                        """)
                .param("attempted", Timestamp.from(attemptedAfter)).param("checked", Timestamp.from(checkedBefore))
                .param("limit", limit).query(String.class).list();
    }

    /** Stamps a capture attempt on an open order; false when the order is no longer open. */
    boolean markCaptureAttempted(String orderId) {
        return jdbc.sql("""
                        UPDATE paypal_order SET capture_attempted_at = :now
                        WHERE order_id = :order AND status = 'CREATED'
                        """)
                .param("order", orderId).param("now", Timestamp.from(clock.instant())).update() == 1;
    }

    /** Records that an order was looked at without a change, so the next run looks at others first. */
    void checked(String orderId, Status status) {
        jdbc.sql("UPDATE paypal_order SET updated_at = :now WHERE order_id = :order AND status = :status")
                .param("order", orderId).param("status", status.name())
                .param("now", Timestamp.from(clock.instant())).update();
    }

    void mark(String orderId, Status status, @Nullable String captureId) {
        jdbc.sql("""
                        UPDATE paypal_order
                        SET status = :status, capture_id = coalesce(CAST(:capture AS text), capture_id),
                            updated_at = :now
                        WHERE order_id = :order
                        """)
                .param("order", orderId).param("status", status.name()).param("capture", captureId)
                .param("now", Timestamp.from(clock.instant())).update();
    }

    enum Status { CREATED, CAPTURED, LATE_CAPTURED, REJECTED, VOIDED }

    record StoredOrder(String orderId, UUID bookingId, UUID accountId, PayPalEnvironment environment, int amountMinor,
                       Currency currency, Status status, URI approveUrl, @Nullable Instant captureAttemptedAt) {
    }
}
