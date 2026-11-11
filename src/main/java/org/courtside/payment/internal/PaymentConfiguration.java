package org.courtside.payment.internal;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.net.URI;
import java.util.concurrent.ThreadPoolExecutor;

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

    // One run at a time, off the shared scheduler thread; a tick while a run is busy is dropped.
    @Bean
    TaskExecutor payPalReconciliationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(0);
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.DiscardPolicy());
        executor.setThreadNamePrefix("paypal-reconciliation-");
        executor.initialize();
        return executor;
    }

    @Bean
    PayPalConnectionCheck payPalConnectionCheck(PayPalClient client) {
        return new PayPalConnectionCheck(client);
    }
}
