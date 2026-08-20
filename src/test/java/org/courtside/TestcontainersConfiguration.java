package org.courtside;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

    @Bean
    JdbcConnectionDetails postgresConnectionDetails(Environment environment) {
        PostgreSQLContainer postgres = sharedPostgres();
        String database = environment.acceptsProfiles(Profiles.of("demo"))
                ? "courtside_dev"
                : "courtside_" + UUID.randomUUID().toString().replace("-", "");
        createDatabase(postgres, database);
        return new PostgresConnectionDetails(
                postgres.getJdbcUrl().replace("/test?", "/" + database + "?"),
                postgres.getUsername(), postgres.getPassword());
    }

    static PostgreSQLContainer sharedPostgres() {
        return PostgresHolder.INSTANCE;
    }

    private static void createDatabase(PostgreSQLContainer postgres, String database) {
        try (var connection = DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
             var statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + database);
        } catch (SQLException failure) {
            throw new IllegalStateException("Could not create an isolated integration-test database", failure);
        }
    }

    private static final class PostgresHolder {

        private static final PostgreSQLContainer INSTANCE = startPostgres();

        private static PostgreSQLContainer startPostgres() {
            PostgreSQLContainer postgres = new PostgreSQLContainer(DockerImageName
                    .parse("postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193")
                    .asCompatibleSubstituteFor("postgres"));
            postgres.start();
            return postgres;
        }
    }

    private record PostgresConnectionDetails(String jdbcUrl, String username, String password)
            implements JdbcConnectionDetails {

        @Override
        public String getJdbcUrl() {
            return jdbcUrl;
        }

        @Override
        public String getUsername() {
            return username;
        }

        @Override
        public String getPassword() {
            return password;
        }
    }
}
