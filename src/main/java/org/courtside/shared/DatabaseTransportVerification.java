package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.config.BeanPostProcessor;

class DatabaseTransportVerification implements BeanPostProcessor, SmartInitializingSingleton {

    private static final String UNENFORCED_ACTION = "Give the application a connection pool this"
            + " can configure, or set courtside.database.tls.mode back to prefer.";

    private final ObjectProvider<DatabaseTlsProperties> properties;

    private boolean applied;

    DatabaseTransportVerification(ObjectProvider<DatabaseTlsProperties> properties) {
        this.properties = properties;
    }

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        if (bean instanceof HikariDataSource dataSource) {
            DatabaseTls.apply(dataSource, properties.getObject());
            applied = true;
        }
        return bean;
    }

    @Override
    public void afterSingletonsInstantiated() {
        if (!applied && properties.getObject().mode() == DatabaseTlsProperties.Mode.VERIFY_FULL) {
            throw new TlsConfigurationException("Verified database TLS is configured, but"
                    + " no connection pool was configured with it.", UNENFORCED_ACTION);
        }
    }
}
