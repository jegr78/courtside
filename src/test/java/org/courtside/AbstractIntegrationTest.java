package org.courtside;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@SpringBootTest
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, FixedClockConfiguration.class})
public abstract class AbstractIntegrationTest {

    private static final String BASELINE_SCHEMA = "test_baseline";
    private static final Set<String> SEEDED_TABLES = Set.of(
            "booking_card",
            "booking_card_allowed_role",
            "booking_card_managing_role",
            "club_config",
            "membership_type",
            "participant_card",
            "rule_definition",
            "rule_set");
    private static List<String> baselineTables;
    private static List<String> insertionOrder;

    @Autowired
    private JdbcClient jdbc;

    @BeforeAll
    static synchronized void captureDatabaseBaseline(@Autowired JdbcClient jdbc) {
        jdbc.sql("CREATE SCHEMA IF NOT EXISTS " + BASELINE_SCHEMA).update();
        baselineTables = publicTables(jdbc);
        insertionOrder = insertionOrder(jdbc, baselineTables);
        Set<String> capturedTables = new HashSet<>(jdbc.sql("""
                        SELECT tablename FROM pg_tables WHERE schemaname = :schema
                        """).param("schema", BASELINE_SCHEMA).query(String.class).list());
        baselineTables.stream()
                .filter(table -> !capturedTables.contains(table))
                .forEach(table -> jdbc.sql("CREATE TABLE " + BASELINE_SCHEMA + "." + table
                        + " AS TABLE public." + table + (SEEDED_TABLES.contains(table) ? "" : " WITH NO DATA"))
                        .update());
    }

    @BeforeEach
    @AfterEach
    protected void restoreDatabaseBaseline() {
        List<String> currentTables = publicTables(jdbc);
        if (!currentTables.equals(baselineTables)) {
            throw new IllegalStateException("Integration-test schema changed after baseline capture: " + currentTables);
        }
        jdbc.sql("TRUNCATE TABLE " + String.join(", ", baselineTables.stream()
                .map(table -> "public." + table).toList()) + " RESTART IDENTITY CASCADE").update();
        insertionOrder.forEach(table -> jdbc.sql("INSERT INTO public." + table
                + " SELECT * FROM " + BASELINE_SCHEMA + "." + table).update());
    }

    private static List<String> publicTables(JdbcClient jdbc) {
        return jdbc.sql("""
                        SELECT tablename
                        FROM pg_tables
                        WHERE schemaname = 'public'
                          AND tablename <> 'flyway_schema_history'
                        ORDER BY tablename
                        """)
                .query(String.class)
                .list();
    }

    private static List<String> insertionOrder(JdbcClient jdbc, List<String> tables) {
        List<ForeignKey> foreignKeys = jdbc.sql("""
                        SELECT child.relname, parent.relname
                        FROM pg_constraint constraint_definition
                        JOIN pg_class child ON child.oid = constraint_definition.conrelid
                        JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
                        JOIN pg_class parent ON parent.oid = constraint_definition.confrelid
                        JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
                        WHERE constraint_definition.contype = 'f'
                          AND child_schema.nspname = 'public'
                          AND parent_schema.nspname = 'public'
                        """)
                .query((result, row) -> new ForeignKey(result.getString(1), result.getString(2)))
                .list();
        List<String> remaining = new ArrayList<>(tables);
        List<String> ordered = new ArrayList<>();
        Set<String> inserted = new HashSet<>();
        while (!remaining.isEmpty()) {
            List<String> ready = remaining.stream()
                    .filter(table -> foreignKeys.stream()
                            .filter(key -> key.child().equals(table) && !key.parent().equals(table))
                            .allMatch(key -> inserted.contains(key.parent())))
                    .toList();
            if (ready.isEmpty()) {
                throw new IllegalStateException("Foreign-key cycle prevents integration-test baseline restore: "
                        + remaining);
            }
            ordered.addAll(ready);
            inserted.addAll(ready);
            remaining.removeAll(ready);
        }
        return List.copyOf(ordered);
    }

    private record ForeignKey(String child, String parent) {
    }
}
