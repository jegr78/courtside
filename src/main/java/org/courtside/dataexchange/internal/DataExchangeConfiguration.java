package org.courtside.dataexchange.internal;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ImportProperties.class)
class DataExchangeConfiguration {
}
