package org.courtside.shared.internal;

import org.courtside.shared.ServerTlsProperties;
import org.courtside.shared.WarmUpReads;
import org.courtside.shared.WarmUpStep;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

import java.util.List;
import java.util.stream.Stream;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(WarmUpProperties.class)
class WarmUpConfiguration {

    @Bean
    StartupWarmUp startupWarmUp(ObjectProvider<WarmUpReads> reads, ObjectProvider<WarmUpStep> steps,
                                ApplicationContext context, ServerTlsProperties tls, WarmUpProperties properties) {
        Stream<WarmUpStep> loopback = reads.orderedStream()
                .map(read -> new LoopbackReadStep(read.name(), read::paths, context, tls));
        return new StartupWarmUp(Stream.concat(loopback, steps.orderedStream()).toList(), properties);
    }

    @Bean
    @Order(10)
    WarmUpReads publicReadsWarmUp() {
        return new WarmUpReads() {
            @Override
            public String name() {
                return "public-reads";
            }

            @Override
            public List<String> paths() {
                return List.of(
                        "/api/public/config",
                        "/api/public/courts",
                        "/api/public/opening-hours",
                        "/api/public/booking-grid",
                        "/api/public/booking-card-legend",
                        "/manifest.webmanifest");
            }
        };
    }
}
