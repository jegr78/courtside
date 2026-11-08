package org.courtside.payment.testfixture;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.simple.JdbcClient;

@RequiredArgsConstructor
public final class PaymentTestFixture {

    private final JdbcClient jdbc;

    public void storePayPal(boolean enabled) {
        jdbc.sql("""
                INSERT INTO paypal_settings (id, client_id, secret_ciphertext, secret_stored_at, environment, enabled,
                                             updated_at)
                VALUES (gen_random_uuid(), 'client-sandbox', 'stored-ciphertext', now(), 'SANDBOX', :enabled, now())
                """).param("enabled", enabled).update();
    }
}
