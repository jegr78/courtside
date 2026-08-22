package org.courtside;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

    private static final Path DEPLOYMENT = Path.of("deploy", "compose.yaml");
    private static final Pattern POSTGRES_IMAGE =
            Pattern.compile("postgres:[\\w.-]+@sha256:[a-f0-9]{64}");

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
                    .parse(deployedImage())
                    .asCompatibleSubstituteFor("postgres"));
            postgres.start();
            return postgres;
        }

        // Qualifying against a database a club does not run proves nothing about the one it does,
        // so the reference is read from the deployment rather than repeated beside it.
        private static String deployedImage() {
            try {
                Matcher found = POSTGRES_IMAGE.matcher(Files.readString(DEPLOYMENT));
                if (!found.find()) {
                    throw new IllegalStateException(
                            DEPLOYMENT + " names no PostgreSQL image pinned by digest");
                }
                return found.group();
            } catch (IOException e) {
                throw new IllegalStateException("Could not read " + DEPLOYMENT, e);
            }
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
