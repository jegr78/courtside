package org.courtside;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
@Import({FixedClockConfiguration.class, QuietMailConfiguration.class})
class DatabaseTlsTest {

    private static final TestCertificate SERVED = issued("localhost");
    private static final PostgreSQLContainer DATABASE = started(SERVED);
    private static final Path ANCHOR = written(SERVED.authority());

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private HikariDataSource pool;

    @DynamicPropertySource
    static void verifiedTransport(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("spring.datasource.hikari.connection-timeout", () -> 2000);
        registry.add("courtside.database.tls.mode", () -> "verify-full");
        registry.add("courtside.database.tls.root-certificate", ANCHOR::toString);
    }

    @Test
    void givenAVerifiedTransport_whenTheApplicationQueries_thenItsOwnConnectionIsEncrypted() {
        // when
        String version = jdbc.sql("""
                        SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()
                        """).query(String.class).single();

        // then
        assertThat(version).startsWith("TLSv1.");
    }

    // A replaced anchor decides the next connection, so a rotation cannot leave verification behind.
    @Test
    void givenTheAnchorIsReplaced_whenThePoolReconnects_thenTheForeignAuthorityIsRefused()
            throws Exception {
        // given
        assertThat(encrypted()).isTrue();

        // when
        Files.writeString(ANCHOR, issued("localhost").authority());
        pool.getHikariPoolMXBean().softEvictConnections();

        // then
        try {
            assertThatThrownBy(this::encrypted)
                    .isInstanceOf(SQLException.class)
                    .hasStackTraceContaining("Path does not chain with any of the trust anchors");
        } finally {
            Files.writeString(ANCHOR, SERVED.authority());
            pool.getHikariPoolMXBean().softEvictConnections();
        }
        assertThat(encrypted()).isTrue();
    }

    private boolean encrypted() throws SQLException {
        try (Connection connection = pool.getConnection();
             var statement = connection.createStatement();
             var rows = statement.executeQuery(
                     "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")) {
            rows.next();
            return rows.getBoolean(1);
        }
    }

    private static TestCertificate issued(String name) {
        try {
            return TestCertificate.issuedFor(name);
        } catch (Exception failure) {
            throw new IllegalStateException("Could not issue the database certificate", failure);
        }
    }

    private static PostgreSQLContainer started(TestCertificate pair) {
        PostgreSQLContainer database = TestPostgres.serving(pair);
        database.start();
        return database;
    }

    private static Path written(String authority) {
        try {
            return Files.writeString(Files.createTempFile("courtside-anchor-", ".pem"), authority);
        } catch (Exception failure) {
            throw new IllegalStateException("Could not write the database trust anchor", failure);
        }
    }
}
