package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.boot.transaction.autoconfigure.TransactionManagerCustomizers;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.sql.SQLException;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(DatabaseDeadlineProperties.class)
class DatabaseDeadlineConfiguration {

    @Bean
    static BeanPostProcessor databaseStatementTimeout(ObjectProvider<DatabaseDeadlineProperties> properties) {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessBeforeInitialization(Object bean, String beanName) {
                if (bean instanceof HikariDataSource dataSource) {
                    String statementTimeoutSql = "SET statement_timeout TO "
                            + properties.getObject().statementTimeout().toMillis();
                    String existingSql = dataSource.getConnectionInitSql();
                    dataSource.setConnectionInitSql(existingSql == null || existingSql.isBlank()
                            ? statementTimeoutSql
                            : existingSql + "; " + statementTimeoutSql);
                }
                return bean;
            }
        };
    }

    // Flyway's connections ran without a statement timeout, so none of them may stay in the pool.
    @Bean
    FlywayMigrationStrategy migrateThenRenewPooledConnections(DataSource dataSource) {
        return flyway -> {
            flyway.migrate();
            try {
                if (dataSource.isWrapperFor(HikariDataSource.class)) {
                    HikariPoolMXBean pool = dataSource.unwrap(HikariDataSource.class).getHikariPoolMXBean();
                    if (pool != null) {
                        pool.softEvictConnections();
                    }
                }
            } catch (SQLException failure) {
                throw new IllegalStateException("The connection pool could not be renewed after migration", failure);
            }
        };
    }

    @Bean
    PlatformTransactionManager transactionManager(EntityManagerFactory entityManagerFactory,
                                                  DatabaseDeadlineProperties properties,
                                                  ObjectProvider<TransactionManagerCustomizers> customizers) {
        RequestDeadlineTransactionManager manager = new RequestDeadlineTransactionManager(
                entityManagerFactory, properties.requestTransactionTimeout());
        customizers.ifAvailable(customizer -> customizer.customize(manager));
        return manager;
    }
}
