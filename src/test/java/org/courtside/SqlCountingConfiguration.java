package org.courtside;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Role;

import javax.sql.DataSource;
import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.ConnectionBuilder;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Statement;
import java.util.logging.Logger;

@TestConfiguration(proxyBeanMethods = false)
public class SqlCountingConfiguration {

    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    static SqlStatementCounter sqlStatementCounter() {
        return new SqlStatementCounter();
    }

    @Bean
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    static BeanPostProcessor countingDataSourcePostProcessor(SqlStatementCounter counter) {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
                return bean instanceof DataSource dataSource
                        ? new CountingDataSource(dataSource, counter)
                        : bean;
            }
        };
    }

    private record CountingDataSource(DataSource delegate, SqlStatementCounter counter) implements DataSource {

        @Override
        public Connection getConnection() throws SQLException {
            return connection(delegate.getConnection(), counter);
        }

        @Override
        public Connection getConnection(String username, String password) throws SQLException {
            return connection(delegate.getConnection(username, password), counter);
        }

        @Override
        public PrintWriter getLogWriter() throws SQLException {
            return delegate.getLogWriter();
        }

        @Override
        public void setLogWriter(PrintWriter out) throws SQLException {
            delegate.setLogWriter(out);
        }

        @Override
        public void setLoginTimeout(int seconds) throws SQLException {
            delegate.setLoginTimeout(seconds);
        }

        @Override
        public int getLoginTimeout() throws SQLException {
            return delegate.getLoginTimeout();
        }

        @Override
        public ConnectionBuilder createConnectionBuilder() throws SQLException {
            return delegate.createConnectionBuilder();
        }

        @Override
        public Logger getParentLogger() throws SQLFeatureNotSupportedException {
            return delegate.getParentLogger();
        }

        @Override
        public <T> T unwrap(Class<T> iface) throws SQLException {
            return iface.isInstance(this) ? iface.cast(this) : delegate.unwrap(iface);
        }

        @Override
        public boolean isWrapperFor(Class<?> iface) throws SQLException {
            return iface.isInstance(this) || delegate.isWrapperFor(iface);
        }
    }

    private static Connection connection(Connection target, SqlStatementCounter counter) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(),
                new Class<?>[]{Connection.class}, (proxy, method, arguments) -> {
                    Object result = invoke(target, method, arguments);
                    if (result instanceof CallableStatement statement && arguments != null
                            && arguments.length > 0 && arguments[0] instanceof String sql) {
                        return statement(statement, CallableStatement.class, sql, counter);
                    }
                    if (result instanceof PreparedStatement statement && arguments != null
                            && arguments.length > 0 && arguments[0] instanceof String sql) {
                        return statement(statement, PreparedStatement.class, sql, counter);
                    }
                    if (result instanceof Statement statement) {
                        return statement(statement, Statement.class, null, counter);
                    }
                    return result;
                });
    }

    private static Object statement(Statement target, Class<?> type, String preparedSql,
                                    SqlStatementCounter counter) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type},
                (proxy, method, arguments) -> {
                    if (method.getName().startsWith("execute")) {
                        String sql = preparedSql;
                        if (sql == null && arguments != null && arguments.length > 0
                                && arguments[0] instanceof String suppliedSql) {
                            sql = suppliedSql;
                        }
                        if (sql != null) {
                            counter.record(sql);
                        }
                    }
                    return invoke(target, method, arguments);
                });
    }

    private static Object invoke(Object target, Method method, Object[] arguments) throws Throwable {
        try {
            return method.invoke(target, arguments);
        } catch (InvocationTargetException exception) {
            throw exception.getCause();
        }
    }
}
