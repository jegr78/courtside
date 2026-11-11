package org.courtside.payment;

import org.courtside.TestPostgres;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers(disabledWithoutDocker = true)
class PayPalOrderFingerprintMigrationTest {

    @Container
    private final PostgreSQLContainer<?> database = new PostgreSQLContainer<>(TestPostgres.deployedImage());

    @Test
    void givenOrdersFromBeforeTheFingerprint_whenTheUpgradeRuns_thenOnlyThoseItsCredentialsCreatedNameItsAccount()
            throws Exception {
        // given
        migrateTo("94");
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            statement.execute("""
                    INSERT INTO paypal_settings (id, client_id, secret_ciphertext, secret_stored_at, environment,
                                                 enabled, updated_at)
                    VALUES ('7f600000-0000-0000-0000-000000000001', 'client-sandbox', 'stored-ciphertext',
                            '2026-06-01T00:00:00Z', 'SANDBOX', false, now());
                    INSERT INTO paypal_order (order_id, booking_id, account_id, environment, amount_minor, currency,
                                              status, capture_id, approve_url, created_at, updated_at)
                    VALUES ('ORDERSANDBOX', '7f600000-0000-0000-0000-000000000011',
                            '7f600000-0000-0000-0000-000000000021', 'SANDBOX', 1500, 'EUR', 'CAPTURED', 'CAPTURE1',
                            'https://paypal.example.org/checkoutnow', '2026-07-01T00:00:00Z', now()),
                           ('ORDEREARLIER', '7f600000-0000-0000-0000-000000000013',
                            '7f600000-0000-0000-0000-000000000021', 'SANDBOX', 1500, 'EUR', 'CAPTURED', 'CAPTURE3',
                            'https://paypal.example.org/checkoutnow', '2026-05-01T00:00:00Z', now()),
                           ('ORDERLIVE', '7f600000-0000-0000-0000-000000000012',
                            '7f600000-0000-0000-0000-000000000021', 'LIVE', 1500, 'EUR', 'CAPTURED', 'CAPTURE2',
                            'https://paypal.example.org/checkoutnow', '2026-07-01T00:00:00Z', now());
                    """);
        }

        // when
        migrateTo("latest");

        // then
        try (Connection connection = connect(); var statement = connection.createStatement()) {
            Map<String, String> fingerprints = fingerprints(statement.executeQuery(
                    "SELECT order_id, client_fingerprint FROM paypal_order ORDER BY order_id"));
            assertThat(fingerprints).as("the stored client id names only the orders created since its secret")
                    .containsEntry("ORDERSANDBOX", sha256("client-sandbox"))
                    .containsEntry("ORDEREARLIER", null)
                    .containsEntry("ORDERLIVE", null);
        }
    }

    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private void migrateTo(String target) {
        Flyway.configure()
                .dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword())
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private static Map<String, String> fingerprints(ResultSet rows) throws Exception {
        Map<String, String> values = new LinkedHashMap<>();
        while (rows.next()) {
            values.put(rows.getString(1), rows.getString(2));
        }
        return values;
    }

    private Connection connect() throws Exception {
        return DriverManager.getConnection(database.getJdbcUrl(), database.getUsername(), database.getPassword());
    }
}
