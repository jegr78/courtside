package org.courtside.demo;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@Profile("demo")
@Order(-100)
class DemoEnvironmentGuard implements ApplicationRunner {

    private static final Pattern LOCAL_POSTGRESQL = Pattern.compile(
            "jdbc:postgresql://(?:localhost|127\\.0\\.0\\.1):[0-9]+/([^?]+)(?:\\?.*)?");
    private static final Set<String> LOOPBACK_ADDRESSES = Set.of("127.0.0.1", "localhost", "::1");

    private final DataSource dataSource;
    private final Environment environment;
    private final DemoProperties properties;
    private final String serverAddress;

    DemoEnvironmentGuard(DataSource dataSource, Environment environment, DemoProperties properties,
                         @Value("${server.address}") String serverAddress) {
        this.dataSource = dataSource;
        this.environment = environment;
        this.properties = properties;
        this.serverAddress = serverAddress;
    }

    @Override
    public void run(ApplicationArguments arguments) throws SQLException {
        if (!properties.confirmDisposable()) {
            throw new IllegalStateException(
                    "COURTSIDE_DEMO_CONFIRM_DISPOSABLE=true is required for the demo profile");
        }
        if (!LOOPBACK_ADDRESSES.contains(serverAddress)) {
            throw new IllegalStateException("The demo profile requires a loopback server address");
        }
        if (!isLocalDevelopmentDatabase()) {
            throw new IllegalStateException(
                    "The demo profile requires a local PostgreSQL database named courtside_dev");
        }
    }

    private boolean isTestProfile() {
        return Arrays.asList(environment.getActiveProfiles()).contains("test");
    }

    private boolean isLocalDevelopmentDatabase() throws SQLException {
        try (var connection = dataSource.getConnection()) {
            String url = connection.getMetaData().getURL();
            Matcher matcher = LOCAL_POSTGRESQL.matcher(url);
            return matcher.matches()
                    && (matcher.group(1).equals("courtside_dev")
                    || isTestProfile() && matcher.group(1).equals("test"));
        }
    }
}
