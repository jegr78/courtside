package org.courtside.payment.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.InstanceSecrets;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RequiredArgsConstructor
public final class PaymentTestFixture {

    private static final String SECRET_PURPOSE = "payment:paypal-secret";

    private final JdbcClient jdbc;
    private final InstanceSecrets secrets;

    public void storePayPal(boolean enabled) {
        jdbc.sql("""
                INSERT INTO paypal_settings (id, client_id, secret_ciphertext, secret_stored_at, environment, enabled,
                                             updated_at)
                VALUES (gen_random_uuid(), 'client-sandbox', 'stored-ciphertext', now(), 'SANDBOX', :enabled, now())
                """).param("enabled", enabled).update();
    }

    public void storePayPalCredentials(String environment, String clientId, String secret) {
        jdbc.sql("""
                        INSERT INTO paypal_settings (id, client_id, secret_ciphertext, secret_stored_at, environment,
                                                     enabled, updated_at)
                        VALUES (gen_random_uuid(), :client, :secret, now(), :environment, true, now())
                        """)
                .param("client", clientId)
                .param("secret", secrets.encrypt(SECRET_PURPOSE, secret.getBytes(StandardCharsets.UTF_8)))
                .param("environment", environment).update();
    }

    public void switchPayPalEnvironment(String environment) {
        jdbc.sql("UPDATE paypal_settings SET environment = :environment").param("environment", environment).update();
    }

    public String pendingRefund(UUID accountId, UUID bookingId) {
        String orderId = order(accountId, bookingId, "CAPTURED");
        jdbc.sql("""
                        INSERT INTO paypal_refund (id, order_id, account_id, amount_minor, currency, status, requested_by,
                                                   requested_at, updated_at)
                        VALUES (gen_random_uuid(), :order, :account, 1500, 'EUR', 'PENDING', :account, now(), now())
                        """)
                .param("order", orderId).param("account", accountId).update();
        return orderId;
    }

    public String orderWithCaptureAttempted(UUID accountId, UUID bookingId) {
        return order(accountId, bookingId, "CREATED");
    }

    private String order(UUID accountId, UUID bookingId, String status) {
        String orderId = "ORDER-" + bookingId;
        jdbc.sql("""
                        INSERT INTO paypal_order (order_id, booking_id, account_id, environment, amount_minor, currency,
                                                  status, capture_id, capture_attempted_at, approve_url, created_at,
                                                  updated_at)
                        VALUES (:order, :booking, :account, 'SANDBOX', 1500, 'EUR', :status,
                                CASE WHEN :status = 'CAPTURED' THEN 'CAPTURE-' || :order END, now(),
                                'https://www.sandbox.paypal.com/checkoutnow?token=' || :order, now(), now())
                        """)
                .param("order", orderId).param("booking", bookingId).param("account", accountId)
                .param("status", status).update();
        return orderId;
    }
}
