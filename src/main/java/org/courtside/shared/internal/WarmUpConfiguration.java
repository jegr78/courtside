package org.courtside.shared.internal;

import org.courtside.shared.WarmUpStep;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(WarmUpProperties.class)
class WarmUpConfiguration {

    @Bean
    StartupWarmUp startupWarmUp(ObjectProvider<WarmUpStep> steps, WarmUpProperties properties) {
        return new StartupWarmUp(steps.orderedStream().toList(), properties);
    }
}
