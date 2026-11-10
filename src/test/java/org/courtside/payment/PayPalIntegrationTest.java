package org.courtside.payment;

import org.courtside.AbstractIntegrationTest;
import org.courtside.credit.BookingPayments;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

// Two admission slots and a larger pool let two treasurers' returns meet at the order's row lock.
@TestPropertySource(properties = {"courtside.public-url=https://courts.example.org",
        "courtside.payment.paypal.request-timeout=1s", "courtside.admission.classes[payment-provider-check].cost=5",
        "courtside.admission.classes[payment-provider-check].concurrency=2",
        "spring.datasource.hikari.maximum-pool-size=6"})
abstract class PayPalIntegrationTest extends AbstractIntegrationTest {

    static final FakePayPal PAYPAL = new FakePayPal();

    @MockitoSpyBean
    protected BookingPayments bookingPayments;

    @DynamicPropertySource
    static void endpoints(DynamicPropertyRegistry registry) {
        String base = "http://127.0.0.1:" + PAYPAL.port();
        registry.add("courtside.payment.paypal.sandbox-endpoint", () -> base + "/sandbox");
        registry.add("courtside.payment.paypal.live-endpoint", () -> base + "/live");
    }

    @BeforeEach
    void resetPayPal() {
        PAYPAL.reset();
    }
}
