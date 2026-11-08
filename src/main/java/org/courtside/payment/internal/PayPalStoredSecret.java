package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.EncryptedSecretHolder;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
class PayPalStoredSecret implements EncryptedSecretHolder {

    static final String PURPOSE = "payment:paypal-secret";

    private final JdbcClient jdbc;

    @Override
    public List<StoredSecret> storedSecrets() {
        return jdbc.sql("SELECT secret_ciphertext FROM paypal_settings WHERE secret_ciphertext IS NOT NULL")
                .query(String.class).list().stream()
                .map(encrypted -> new StoredSecret(PURPOSE, encrypted))
                .toList();
    }
}
