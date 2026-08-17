package org.courtside;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class UpgradeProofTest extends AbstractIntegrationTest {

    private static final Path PROOF = Path.of("upgrade", "verify.sql");

    private static final Pattern SECRET_NAME =
            Pattern.compile("(?i).*(password|secret|token|credential|hash|key).*");
    private static final Pattern REDACTED = Pattern.compile("[0-9a-f]{32}");

    private static final List<String> EXPECTED_KEYS = List.of(
            "people", "accounts", "roles", "members", "courts", "ruleSets", "rules", "bookings",
            "allocations", "participants", "series", "sessions", "loginLimits",
            "idempotencyRecords", "configuration", "personRows", "accountRows", "roleRows",
            "memberRows", "courtRows", "ruleSetRows", "ruleRows", "bookingRows", "allocationRows",
            "participantRows", "seriesRows", "seriesCourtRows", "sessionRows", "loginLimitRows");

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenTheMigratedSchema_whenTheProofRuns_thenItAnswersEveryEntryItPromises() throws IOException {
        // given
        String statement = Files.readString(PROOF);

        // when
        JsonNode proof = run(statement);

        // then
        assertThat(proof.isObject()).isTrue();
        assertThat(proof.propertyNames()).containsExactlyInAnyOrderElementsOf(EXPECTED_KEYS);
    }

    @Test
    void givenAnAccountInTheProof_whenItIsCaptured_thenEverySecretColumnIsRedacted() throws IOException {
        // given
        seedTheCapturedAccount();

        // when
        JsonNode proof = run(Files.readString(PROOF));

        // then
        JsonNode account = proof.get("accountRows").get(0);
        assertThat(account.get("password_hash").asString())
                .as("the proof is uploaded as a build artifact and must not carry the credential")
                .matches(REDACTED)
                .isNotEqualTo("$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA");
        assertThat(secretsIn(proof))
                .as("every value under a secret-sounding name is a fingerprint, not the value")
                .allMatch(value -> REDACTED.matcher(value).matches());
    }

    @Test
    void givenAColumnTheProofDoesNotKnow_whenItIsCaptured_thenItIsCapturedAnyway() throws IOException {
        // given
        seedTheCapturedAccount();

        // when
        JsonNode account = run(Files.readString(PROOF)).get("accountRows").get(0);

        // then
        assertThat(account.propertyNames())
                .as("the proof captures whole rows, so a column added by a migration is included "
                        + "without anyone editing it — which is why the redaction must be a rule")
                .contains("security_epoch", "version", "enabled", "created_at");
    }

    private void seedTheCapturedAccount() {
        UUID personId = UUID.fromString("71000000-0000-0000-0000-000000000001");
        jdbc.sql("INSERT INTO person (id, first_name, last_name, email) VALUES (?, ?, ?, ?)")
                .params(personId, "John", "Roe", "upgrade-fixture@example.org")
                .update();
        jdbc.sql("""
                        INSERT INTO user_account
                            (id, person_id, username, password_hash, locale, enabled,
                             created_at, password_change_required)
                        VALUES ('72000000-0000-0000-0000-000000000001', ?, 'upgrade-member', ?,
                                'en', true, '2025-01-01T00:00:00Z', false)
                        """)
                .params(personId, "$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA")
                .update();
    }

    private List<String> secretsIn(JsonNode proof) {
        List<String> values = new ArrayList<>();
        collectSecrets(proof, values);
        return values;
    }

    private static void collectSecrets(JsonNode node, List<String> values) {
        if (node.isArray()) {
            node.forEach(child -> collectSecrets(child, values));
            return;
        }
        if (!node.isObject()) {
            return;
        }
        node.properties().forEach(property -> {
            JsonNode value = property.getValue();
            if (value.isObject() || value.isArray()) {
                collectSecrets(value, values);
            } else if (!value.isNull() && SECRET_NAME.matcher(property.getKey()).matches()) {
                values.add(value.asString());
            }
        });
    }

    private JsonNode run(String statement) throws IOException {
        String answer = jdbc.sql(statement).query(String.class).single();
        return new ObjectMapper().readTree(answer);
    }
}
