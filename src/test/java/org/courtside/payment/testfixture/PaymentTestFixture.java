package org.courtside.payment.testfixture;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.InstanceSecrets;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.nio.charset.StandardCharsets;

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
}
