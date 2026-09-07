package org.courtside.shared;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(DatabaseTlsProperties.class)
class DatabaseTlsConfiguration {

    @Bean
    static DatabaseTransportVerification databaseTransportVerification(
            ObjectProvider<DatabaseTlsProperties> properties) {
        return new DatabaseTransportVerification(properties);
    }
}
