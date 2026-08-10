package org.courtside.performance;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("perf")
@EnableConfigurationProperties(PerformanceProperties.class)
class PerformanceConfiguration {
}
