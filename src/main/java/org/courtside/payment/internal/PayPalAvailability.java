package org.courtside.payment.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.booking.PaymentMethods;
import org.courtside.shared.InstanceAddress;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
class PayPalAvailability implements PaymentMethods {

    private final JdbcClient jdbc;
    private final InstanceAddress instance;

    @Override
    public boolean payPalAvailable() {
        return instance.origin().isPresent() && jdbc.sql("""
                        SELECT EXISTS (SELECT 1 FROM paypal_settings WHERE enabled AND secret_ciphertext IS NOT NULL)
                        """).query(Boolean.class).single();
    }
}
