package org.courtside;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

// Top-level and not nested: Spring Framework 7.1 stops ignoring a nested @Configuration as a
// subclass's default, which would apply them twice.
@SpringBootTest
@Import({TestcontainersConfiguration.class, FixedClockConfiguration.class})
public abstract class AbstractIntegrationTest {

    private static final List<String> TABLES_IN_DELETION_ORDER = List.of(
            "booking_participant",
            "court_allocation",
            "booking",
            "booking_series",
            "user_account_role",
            "user_account",
            "member",
            "person",
            "opening_hours",
            "court");

    private static Map<String, Object> seededClubConfig;
    private static Map<UUID, Boolean> seededBookingCardActiveById;
    private static Map<UUID, Boolean> seededParticipantCardActiveById;
    private static Map<UUID, RuleSetSeed> seededRuleSetById;
    private static Map<UUID, MembershipTypeSeed> seededMembershipTypeById;
    private static Map<UUID, RuleDefinitionSeed> seededRuleDefinitionById;

    @Autowired
    private JdbcClient jdbc;

    // Captured in @BeforeAll and not lazily: a subclass's own @BeforeAll runs later and could
    // otherwise write to club_config before the seed was ever read.
    @BeforeAll
    static void captureSeededClubConfig(@Autowired JdbcClient jdbc) {
        seededClubConfig = jdbc.sql("""
                SELECT club_name, primary_color, accent_color, logo_url, imprint_url, default_locale
                FROM club_config
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).query().singleRow();
    }

    // Never blanket-deleted, because other tests address these rows by fixed seeded id.
    @BeforeAll
    static void captureSeededCardCatalog(@Autowired JdbcClient jdbc) {
        seededBookingCardActiveById = activeById(jdbc, "booking_card");
        seededParticipantCardActiveById = activeById(jdbc, "participant_card");
    }

    private static Map<UUID, Boolean> activeById(JdbcClient jdbc, String table) {
        return jdbc.sql("SELECT id, active FROM " + table)
                .query((rs, rowNum) -> Map.entry(
                        (UUID) rs.getObject("id"), rs.getBoolean("active")))
                .list().stream()
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    // Same as the card catalog: other tests read these rows by literal UUID, so a blanket delete
    // would take the seed with them.
    @BeforeAll
    static void captureSeededRuleConfiguration(@Autowired JdbcClient jdbc) {
        seededRuleSetById = jdbc.sql("SELECT id, name, active FROM rule_set")
                .query((rs, rowNum) -> Map.entry((UUID) rs.getObject("id"), new RuleSetSeed(
                        rs.getString("name"), rs.getBoolean("active"))))
                .list().stream()
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
        seededMembershipTypeById = jdbc.sql("SELECT id, name, rule_set_id, active FROM membership_type")
                .query((rs, rowNum) -> Map.entry((UUID) rs.getObject("id"), new MembershipTypeSeed(
                        rs.getString("name"), (UUID) rs.getObject("rule_set_id"), rs.getBoolean("active"))))
                .list().stream()
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
        seededRuleDefinitionById = jdbc.sql(
                        "SELECT id, rule_set_id, rule_type, params::text AS params FROM rule_definition")
                .query((rs, rowNum) -> Map.entry((UUID) rs.getObject("id"), new RuleDefinitionSeed(
                        (UUID) rs.getObject("rule_set_id"), rs.getString("rule_type"), rs.getString("params"))))
                .list().stream()
                .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey, Map.Entry::getValue));
    }

    // Both phases, because @AfterEach alone still exposes the bootstrap seed to a JVM's first
    // test. The card restore is inline, since Jupiter does not order sibling lifecycle methods.
    @BeforeEach
    @AfterEach
    protected void deleteTransactionalData() {
        TABLES_IN_DELETION_ORDER.forEach(table -> jdbc.sql("DELETE FROM " + table).update());
        restoreCardCatalog("booking_card", seededBookingCardActiveById);
        restoreCardCatalog("participant_card", seededParticipantCardActiveById);
        restoreMembershipTypes();
        restoreRuleSets();
        restoreRuleDefinitions();
    }

    private void restoreCardCatalog(String table, Map<UUID, Boolean> seededActiveById) {
        jdbc.sql("DELETE FROM " + table + " WHERE id NOT IN (:ids)")
                .param("ids", seededActiveById.keySet())
                .update();
        seededActiveById.forEach((id, active) -> jdbc.sql(
                        "UPDATE " + table + " SET active = :active WHERE id = :id")
                .param("active", active)
                .param("id", id)
                .update());
    }

    // Restored rather than deleted, since club_config must always hold exactly one row. Raw SQL,
    // so the fixture does not depend on the code it exists to let other tests trust.
    @BeforeEach
    @AfterEach
    protected void restoreClubConfig() {
        jdbc.sql("""
                UPDATE club_config
                SET club_name = :club_name, primary_color = :primary_color, accent_color = :accent_color,
                    logo_url = :logo_url, imprint_url = :imprint_url, default_locale = :default_locale
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).params(seededClubConfig).update();
    }

    // Before restoreRuleSets(): membership_type.rule_set_id has no ON DELETE, so a seeded row
    // still pointing at a test-created rule set would block its deletion.
    private void restoreMembershipTypes() {
        jdbc.sql("DELETE FROM membership_type WHERE id NOT IN (:ids)")
                .param("ids", seededMembershipTypeById.keySet())
                .update();
        seededMembershipTypeById.forEach((id, seed) -> jdbc.sql("""
                        UPDATE membership_type SET name = :name, rule_set_id = :ruleSetId, active = :active
                        WHERE id = :id
                        """)
                .param("name", seed.name())
                .param("ruleSetId", seed.ruleSetId())
                .param("active", seed.active())
                .param("id", id)
                .update());
    }

    private void restoreRuleSets() {
        jdbc.sql("DELETE FROM rule_set WHERE id NOT IN (:ids)")
                .param("ids", seededRuleSetById.keySet())
                .update();
        seededRuleSetById.forEach((id, seed) -> jdbc.sql(
                        "UPDATE rule_set SET name = :name, active = :active WHERE id = :id")
                .param("name", seed.name())
                .param("active", seed.active())
                .param("id", id)
                .update());
    }

    // Delete-by-id-not-in-seed then upsert, rather than update in place: a re-created definition
    // gets a fresh id, which only the delete clause catches.
    private void restoreRuleDefinitions() {
        jdbc.sql("DELETE FROM rule_definition WHERE id NOT IN (:ids)")
                .param("ids", seededRuleDefinitionById.keySet())
                .update();
        seededRuleDefinitionById.forEach((id, seed) -> jdbc.sql("""
                        INSERT INTO rule_definition (id, rule_set_id, rule_type, params)
                        VALUES (:id, :ruleSetId, :ruleType, :params::jsonb)
                        ON CONFLICT (id) DO UPDATE
                        SET rule_set_id = EXCLUDED.rule_set_id,
                            rule_type = EXCLUDED.rule_type,
                            params = EXCLUDED.params
                        """)
                .param("id", id)
                .param("ruleSetId", seed.ruleSetId())
                .param("ruleType", seed.ruleType())
                .param("params", seed.params())
                .update());
    }

    private record MembershipTypeSeed(String name, UUID ruleSetId, boolean active) {
    }

    private record RuleSetSeed(String name, boolean active) {
    }

    private record RuleDefinitionSeed(UUID ruleSetId, String ruleType, String params) {
    }
}
