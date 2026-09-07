package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.assertj.core.api.Assertions.assertThat;

// The same database serving the same certificate: what changes is the mode an operator chose.
@SpringBootTest
@ActiveProfiles("test")
@Import({FixedClockConfiguration.class, QuietMailConfiguration.class})
class DatabaseTlsDisabledTest {

    private static final PostgreSQLContainer DATABASE = started();

    @Autowired
    private JdbcClient jdbc;

    @DynamicPropertySource
    static void plaintextTransport(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("courtside.database.tls.mode", () -> "disable");
    }

    @Test
    void givenTheDisabledMode_whenTheApplicationQueries_thenItsConnectionCarriesNoTls() {
        // when
        boolean encrypted = jdbc.sql("""
                        SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()
                        """).query(Boolean.class).single();

        // then
        assertThat(encrypted).isFalse();
    }

    private static PostgreSQLContainer started() {
        try {
            PostgreSQLContainer database = TestPostgres.serving(TestCertificate.issuedFor("localhost"));
            database.start();
            return database;
        } catch (Exception failure) {
            throw new IllegalStateException("Could not start the database", failure);
        }
    }
}
