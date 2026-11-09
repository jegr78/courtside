package org.courtside.payment.internal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.net.URI;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(PayPalProperties.class)
class PaymentConfiguration {

    private static final URI SANDBOX = URI.create("https://api-m.sandbox.paypal.com");
    private static final URI LIVE = URI.create("https://api-m.paypal.com");

    @Bean
    PayPalClient payPalClient(PayPalProperties properties, @Value("${courtside.environment}") String environment) {
        boolean production = "PRODUCTION".equalsIgnoreCase(environment);
        if (production && (!SANDBOX.equals(properties.sandboxEndpoint()) || !LIVE.equals(properties.liveEndpoint()))) {
            throw new IllegalStateException("Configured PayPal endpoints cannot override PayPal in production");
        }
        return new PayPalClient(properties, production);
    }

    @Bean
    PayPalConnectionCheck payPalConnectionCheck(PayPalClient client) {
        return new PayPalConnectionCheck(client);
    }
}
