package org.courtside;

import org.courtside.access.testfixture.AccessTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.credit.testfixture.CreditTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.notification.testfixture.NotificationTestFixture;
import org.courtside.payment.testfixture.PaymentTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@SpringBootTest
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, FixedClockConfiguration.class,
        QuietMailConfiguration.class, SqlCountingConfiguration.class,
        SafePasswordLookupConfiguration.class,
        AccessTestFixture.class, AuditTestFixture.class, BookingTestFixture.class, CardTestFixture.class,
        ConfigTestFixture.class, CreditTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class,
        MemberTestFixture.class, NotificationTestFixture.class, PaymentTestFixture.class, RulesTestFixture.class})
public abstract class AbstractIntegrationTest {

    private static final String BASELINE_SCHEMA = "test_baseline";
    private static final Set<String> SEEDED_TABLES = Set.of(
            "attendance_policy",
            "booking_card",
            "booking_card_allowed_role",
            "booking_card_managing_role",
            "club_config",
            "membership_type",
            "opening_hours_version",
            "participant_card",
            "rule_definition",
            "rule_set");
    private static List<String> baselineTables;
    private static List<String> insertionOrder;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private TestClock testClock;

    @MockitoSpyBean
    protected JavaMailSender sender;

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
    void setTestClock() {
        for (Class<?> type = getClass(); type != null; type = type.getEnclosingClass()) {
            ClockAt at = type.getAnnotation(ClockAt.class);
            if (at != null) {
                testClock.set(Instant.parse(at.value()));
                return;
            }
        }
        testClock.reset();
    }

    @BeforeEach
    @AfterEach
    protected void restoreDatabaseBaseline() {
        List<String> currentTables = publicTables(jdbc);
        if (!currentTables.equals(baselineTables)) {
            throw new IllegalStateException("Integration-test schema changed after baseline capture: " + currentTables);
        }
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            // The ledger refuses TRUNCATE, so only this reset steps past its triggers, and only in this transaction.
            jdbc.sql("SET LOCAL session_replication_role = replica").update();
            jdbc.sql("TRUNCATE TABLE " + String.join(", ", baselineTables.stream()
                    .map(table -> "public." + table).toList()) + " RESTART IDENTITY CASCADE").update();
        });
        insertionOrder.forEach(table -> jdbc.sql("INSERT INTO public." + table
                + " SELECT * FROM " + BASELINE_SCHEMA + "." + table).update());
    }

    protected static List<String> publicTables(JdbcClient jdbc) {
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
