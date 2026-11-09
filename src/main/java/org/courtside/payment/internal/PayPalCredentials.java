package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.InstanceSecrets;
import org.courtside.payment.PayPalEnvironment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Optional;

@Component
@RequiredArgsConstructor
class PayPalCredentials {

    private final JdbcClient jdbc;
    private final InstanceSecrets secrets;

    /** The decrypted credentials while PayPal payment is switched on. */
    Optional<PayPalClient.Credentials> active() {
        return credentials(true);
    }

    /** The decrypted credentials, whether PayPal payment is switched on or off. */
    Optional<PayPalClient.Credentials> stored() {
        return credentials(false);
    }

    Optional<PayPalClient.Credentials> active(PayPalEnvironment environment) {
        return active().filter(credentials -> credentials.environment() == environment);
    }

    Optional<PayPalClient.Credentials> stored(PayPalEnvironment environment) {
        return stored().filter(credentials -> credentials.environment() == environment);
    }

    private Optional<PayPalClient.Credentials> credentials(boolean enabledOnly) {
        return jdbc.sql("""
                        SELECT environment, client_id, secret_ciphertext FROM paypal_settings
                        WHERE secret_ciphertext IS NOT NULL AND (enabled OR NOT :enabledOnly)
                        """)
                .param("enabledOnly", enabledOnly)
                .query((rs, n) -> new PayPalClient.Credentials(PayPalEnvironment.valueOf(rs.getString(1)),
                        rs.getString(2), new String(secrets.decrypt(PayPalStoredSecret.PURPOSE, rs.getString(3)),
                        StandardCharsets.UTF_8)))
                .optional();
    }
}
