package org.courtside.payment.internal;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PaymentConfigurationTest {

    private static final URI SANDBOX = URI.create("https://api-m.sandbox.paypal.com");
    private static final URI LIVE = URI.create("https://api-m.paypal.com");
    private static final URI ELSEWHERE = URI.create("http://127.0.0.1:9000");

    @Test
    void givenProductionNamesAnotherPayPalHost_whenTheCheckIsBuilt_thenTheOverrideIsRefused() {
        // when / then
        assertThatThrownBy(() -> new PaymentConfiguration().payPalConnectionCheck(
                new PayPalProperties(SANDBOX, ELSEWHERE, Duration.ofSeconds(10)), "PRODUCTION"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("cannot override PayPal in production");
        assertThatThrownBy(() -> new PaymentConfiguration().payPalConnectionCheck(
                new PayPalProperties(ELSEWHERE, LIVE, Duration.ofSeconds(10)), "production"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("cannot override PayPal in production");
    }

    @Test
    void givenTheCanonicalHostsOrADevelopmentInstance_whenTheCheckIsBuilt_thenItIsAccepted() {
        // when / then
        assertThat(new PaymentConfiguration().payPalConnectionCheck(
                new PayPalProperties(SANDBOX, LIVE, Duration.ofSeconds(10)), "PRODUCTION")).isNotNull();
        assertThat(new PaymentConfiguration().payPalConnectionCheck(
                new PayPalProperties(ELSEWHERE, ELSEWHERE, Duration.ofSeconds(10)), "DEVELOPMENT")).isNotNull();
    }
}
