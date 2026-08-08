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

// The two configurations are top-level classes rather than nested ones on purpose. Nested
// @Configuration classes are also picked up as a subclass's default context configuration,
// which Spring Framework 7.1 stops ignoring — they would then apply twice, once by detection
// and once by this import.
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

    // A superclass's @BeforeAll runs before a subclass's own @BeforeAll, so capturing the seed
    // here — not lazily on restoreClubConfig()'s first call — closes the window a subclass could
    // otherwise poison first: a @TestInstance(PER_CLASS) class with its own @BeforeAll writing to
    // club_config before this class's @BeforeEach ever runs.
    @BeforeAll
    static void captureSeededClubConfig(@Autowired JdbcClient jdbc) {
        seededClubConfig = jdbc.sql("""
                SELECT club_name, primary_color, accent_color, logo_url, imprint_url, default_locale
                FROM club_config
                WHERE id = '00000000-0000-0000-0000-000000000001'
                """).query().singleRow();
    }

    // booking_card and participant_card are, like club_config, never blanket-deleted: their rows
    // are addressed by fixed seeded id elsewhere (CardServiceTest). Captured here for the same
    // ordering reason as the club config seed.
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

    // rule_set and membership_type carry fixed-id seeded rows (Standard/Youth, Active/Youth) that
    // other integration tests read by literal UUID (AdvanceWindowRuleTest, MaxOpenBookingsRuleTest,
    // AdminOverrideTest, SeriesCreationTest, SeriesControllerTest), so — like the card catalog —
    // neither table can go in TABLES_IN_DELETION_ORDER: a blanket delete would take the seed with
    // it. rule_definition is captured the same way: RuleDefinitionAdminControllerTest writes to it
    // through RuleAdminService.setRule/removeRule, including on the seeded rule sets themselves.
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

    // Bound to both phases: @AfterEach alone would still expose the bootstrap seed to the first
    // test of a JVM, which is the ordering dependency this teardown exists to remove. The card
    // catalog restore runs at the end of this same method, not as a sibling @BeforeEach/@AfterEach,
    // because JUnit Jupiter does not guarantee the relative order of multiple lifecycle methods in
    // one class — and it must run after booking_participant and booking are cleared, since both
    // hold foreign keys into the two card tables.
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

    // club_config is never deleted (it must always have exactly one row), so a test that changes
    // it is restored here instead, for the same ordering reason as deleteTransactionalData. Raw
    // SQL rather than ConfigService: this fixture must not depend on the production code it exists
    // to let other tests trust.
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

    // Must run before restoreRuleSets(): membership_type.rule_set_id has no ON DELETE, so a
    // seeded membership type still pointing at a test-created rule set would block that rule
    // set's deletion unless its own rule_set_id is put back first.
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

    // Deleting by id-not-in-seed and then upserting the seeded rows back (rather than updating in
    // place) also undoes a delete-then-recreate: RuleAdminService.setRule gives a re-created
    // definition a fresh random id, so the row left behind after the delete has an id outside the
    // seed and is caught by the same clause, before the upsert restores the original by its
    // original id.
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
