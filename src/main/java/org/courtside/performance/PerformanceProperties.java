package org.courtside.performance;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("courtside.performance")
record PerformanceProperties(boolean confirmDisposable, String sharedPassword) {
}
