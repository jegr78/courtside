package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.beans.factory.support.StaticListableBeanFactory;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseLockConfigurationTest {

    @Test
    void whenTheOperatorChoosesAnUnboundedOrNeedlesslyLongWait_thenConfigurationIsRejected() {
        // given
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();

            // when / then
            assertThat(validator.validate(new DatabaseLockProperties(Duration.ZERO))).hasSize(1);
            assertThat(validator.validate(new DatabaseLockProperties(Duration.ofSeconds(61)))).hasSize(1);
            assertThat(validator.validate(new DatabaseLockProperties(Duration.ofSeconds(5)))).isEmpty();
        }
    }

    @Test
    void whenPreparingTheConnectionPool_thenTheTypedDurationBecomesSafePostgresSql() {
        // given
        DatabaseLockProperties properties = new DatabaseLockProperties(Duration.ofMillis(2750));
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("databaseLockProperties", properties);
        BeanPostProcessor postProcessor = DatabaseLockConfiguration.databaseLockTimeout(
                beans.getBeanProvider(DatabaseLockProperties.class));
        HikariDataSource dataSource = new HikariDataSource();

        // when
        postProcessor.postProcessBeforeInitialization(dataSource, "dataSource");

        // then
        assertThat(dataSource.getConnectionInitSql()).isEqualTo("SET lock_timeout TO 2750");
    }

    @Test
    void whenThePoolAlreadyHasInitializationSql_thenTheLockBoundDoesNotDiscardIt() {
        // given
        DatabaseLockProperties properties = new DatabaseLockProperties(Duration.ofSeconds(5));
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("databaseLockProperties", properties);
        BeanPostProcessor postProcessor = DatabaseLockConfiguration.databaseLockTimeout(
                beans.getBeanProvider(DatabaseLockProperties.class));
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setConnectionInitSql("SET statement_timeout TO 30000");

        // when
        postProcessor.postProcessBeforeInitialization(dataSource, "dataSource");

        // then
        assertThat(dataSource.getConnectionInitSql())
                .isEqualTo("SET statement_timeout TO 30000; SET lock_timeout TO 5000");
    }
}
