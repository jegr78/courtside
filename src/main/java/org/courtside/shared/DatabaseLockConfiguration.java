package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(DatabaseLockProperties.class)
class DatabaseLockConfiguration {

    @Bean
    static BeanPostProcessor databaseLockTimeout(ObjectProvider<DatabaseLockProperties> properties) {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessBeforeInitialization(Object bean, String beanName) {
                if (bean instanceof HikariDataSource dataSource) {
                    long milliseconds = properties.getObject().lockTimeout().toMillis();
                    String lockTimeoutSql = "SET lock_timeout TO " + milliseconds;
                    String existingSql = dataSource.getConnectionInitSql();
                    dataSource.setConnectionInitSql(existingSql == null || existingSql.isBlank()
                            ? lockTimeoutSql
                            : existingSql + "; " + lockTimeoutSql);
                }
                return bean;
            }
        };
    }
}
