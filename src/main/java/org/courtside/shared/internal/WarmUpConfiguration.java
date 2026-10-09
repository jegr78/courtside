package org.courtside.shared.internal;

import org.courtside.shared.WarmUpStep;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(WarmUpProperties.class)
class WarmUpConfiguration {

    @Bean
    StartupWarmUp startupWarmUp(ObjectProvider<WarmUpStep> steps, WarmUpProperties properties) {
        return new StartupWarmUp(steps.orderedStream().toList(), properties);
    }

    @Bean
    @Order(10)
    WarmUpStep publicReadsWarmUp(ApplicationContext context) {
        return new LoopbackReadStep("public-reads", context, () -> List.of(
                "/api/public/config",
                "/api/public/courts",
                "/api/public/opening-hours",
                "/api/public/booking-grid",
                "/api/public/booking-card-legend",
                "/manifest.webmanifest"));
    }

    @Bean
    @Order(20)
    WarmUpStep courtPlanWarmUp(ApplicationContext context, Clock clock) {
        return new LoopbackReadStep("court-plan", context,
                () -> List.of("/api/bookings?date=" + LocalDate.now(clock)));
    }
}
