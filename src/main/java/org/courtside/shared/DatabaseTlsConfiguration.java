package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(DatabaseTlsProperties.class)
class DatabaseTlsConfiguration {

    @Bean
    static BeanPostProcessor databaseTransportVerification(
            ObjectProvider<DatabaseTlsProperties> properties) {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessBeforeInitialization(Object bean, String beanName) {
                if (bean instanceof HikariDataSource dataSource) {
                    DatabaseTls.apply(dataSource, properties.getObject());
                }
                return bean;
            }
        };
    }
}
