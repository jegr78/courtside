package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;

import java.nio.file.Path;
import java.sql.SQLException;
import java.util.Locale;
import java.util.Map;

public final class DatabaseMigration {

    private static final String COMMAND = "--courtside-database-migrate";
    private static final String URL = "SPRING_DATASOURCE_URL";
    private static final String USERNAME = "COURTSIDE_DB_MIGRATION_USERNAME";
    private static final String PASSWORD_FILE = "COURTSIDE_DB_MIGRATION_PASSWORD_FILE";

    private DatabaseMigration() {
    }

    public static boolean requested(String[] arguments) {
        return arguments.length == 1 && COMMAND.equals(arguments[0]);
    }

    public static void migrate(Map<String, String> environment) {
        migrate(environment, null);
    }

    static void migrate(Map<String, String> environment, String target) {
        String url = required(environment, URL, "the JDBC URL used by the migration process");
        DatabaseIdentityEnvironmentPostProcessor.refuseUrlCredential(url);
        String username = required(environment, USERNAME, "the dedicated migration database role");
        String password = DatabaseSecretFile.read(PASSWORD_FILE, environment.get(PASSWORD_FILE));

        try (HikariDataSource dataSource = new HikariDataSource()) {
            dataSource.setJdbcUrl(url);
            dataSource.setUsername(username);
            dataSource.setPassword(password);
            DatabaseTls.apply(dataSource, tls(environment));
            try {
                var configuration = Flyway.configure()
                        .dataSource(dataSource)
                        .locations("classpath:db/migration");
                if (target != null) {
                    configuration.target(target);
                }
                configuration.load().migrate();
            } catch (RuntimeException failure) {
                if (hasSqlState(failure, "28P01")) {
                    throw new DatabaseIdentityConfigurationException(
                            "The migration credential was refused by PostgreSQL.",
                            "Replace " + PASSWORD_FILE
                                    + " with the current credential for the configured migration role.",
                            failure);
                }
                throw failure;
            }
        }
    }

    static DatabaseTlsProperties tls(Map<String, String> environment) {
        String configured = environment.getOrDefault("COURTSIDE_DB_TLS_MODE", "prefer");
        DatabaseTlsProperties.Mode mode;
        try {
            mode = DatabaseTlsProperties.Mode.valueOf(
                    configured.replace('-', '_').toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException failure) {
            throw new DatabaseIdentityConfigurationException(
                    "COURTSIDE_DB_TLS_MODE is '" + configured + "', not prefer, disable, or verify-full.",
                    "Choose the same database transport policy for migrations and the application.", failure);
        }
        String root = environment.get("COURTSIDE_DB_TLS_ROOT_CERTIFICATE");
        return new DatabaseTlsProperties(mode,
                root == null || root.isBlank() ? null : Path.of(root));
    }

    private static String required(Map<String, String> environment, String key, String purpose) {
        String value = environment.get(key);
        if (value == null || value.isBlank()) {
            throw new DatabaseIdentityConfigurationException(key + " is not configured.",
                    "Set it to " + purpose + ".");
        }
        return value;
    }

    private static boolean hasSqlState(Throwable failure, String expected) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SQLException sql && expected.equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }
}
