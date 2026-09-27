package org.courtside.uatseed;

import org.courtside.AbstractIntegrationTest;
import org.courtside.CourtsideApplication;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(classes = CourtsideApplication.class)
@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class})
class UatBookingSeederIntegrationTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final UUID EXISTING_BOOKING =
            UUID.fromString("99999999-0000-0000-0000-000000000001");

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private Clock clock;

    @Autowired
    private ApplicationContext applicationContext;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture memberships;

    @Autowired
    private FacilityTestFixture facility;

    @Test
    void givenTheRegularApplicationProfile_whenInspectingFixtureBeans_thenTheUatSeederRemainsInactive() {
        // given / when
        var seeders = applicationContext.getBeansOfType(UatBookingSeeder.class);

        // then
        assertThat(seeders).isEmpty();
    }

    @Test
    void givenExistingMembersAndRoles_whenPreviewingWritingAndRepeating_thenOnlyStableBookingsAreAdded() {
        // given
        createIdentity("Morgan", "Member", Set.of(Role.MEMBER));
        createIdentity("Taylor", "Trainer", Set.of(Role.TRAINER));
        createIdentity("Jordan", "Sport", Set.of(Role.SPORT_DIRECTOR));
        createIdentity("Casey", "Grounds", Set.of(Role.GROUNDSKEEPER));
        facility.createCourt(1, "First court");
        facility.createCourt(2, "Second court");
        createExistingBooking();
        long peopleBefore = tableCount("person");
        long accountsBefore = tableCount("user_account");
        long membersBefore = tableCount("member");
        List<String> rolesBefore = roleRows();
        UatBookingSeeder preview = seeder(false);

        // when
        UatBookingSeedReport previewed = preview.seed();
        UatBookingSeedReport written = seeder(true).seed();
        long bookingsAfterFirstWrite = seededBookings();
        UatBookingSeedReport repeated = seeder(true).seed();

        // then
        assertThat(previewed.write()).isFalse();
        assertThat(previewed.planned()).isGreaterThan(100);
        assertThat(previewed.conflicts()).isOne();
        assertThat(previewed.unavailable()).isEmpty();
        assertThat(seededBookings()).isEqualTo(bookingsAfterFirstWrite);
        assertThat(written.inserted()).isEqualTo(bookingsAfterFirstWrite);
        assertThat(written.conflicts()).isOne();
        assertThat(repeated.inserted()).isZero();
        assertThat(repeated.existing()).isEqualTo(bookingsAfterFirstWrite);
        assertThat(tableCount("person")).isEqualTo(peopleBefore);
        assertThat(tableCount("user_account")).isEqualTo(accountsBefore);
        assertThat(tableCount("member")).isEqualTo(membersBefore);
        assertThat(roleRows()).containsExactlyElementsOf(rolesBefore);
        assertThat(jdbc.sql("SELECT EXISTS (SELECT 1 FROM booking WHERE id = :id)")
                .param("id", EXISTING_BOOKING).query(Boolean.class).single()).isTrue();
        assertThat(notes()).anyMatch(note -> note.startsWith("Singles "))
                .anyMatch(note -> note.startsWith("Doubles "))
                .anyMatch(note -> note.startsWith("Guest booking "))
                .anyMatch(note -> note.startsWith("Ball machine "))
                .anyMatch(note -> note.startsWith("Training "))
                .anyMatch(note -> note.startsWith("League match "))
                .anyMatch(note -> note.startsWith("Court closure "));
        assertThat(seedCountBefore(clock.instant())).isPositive();
        assertThat(seedCountAfter(clock.instant())).isPositive();
        assertThat(maximumCourtCount("Training %")).isEqualTo(2);
        assertThat(maximumCourtCount("League match %")).isEqualTo(2);
    }

    @Test
    void givenAnExistingSeed_whenTheWindowAdvances_thenSeriesRulesAndBookingsExtendConsistently() {
        // given
        createIdentity("Taylor", "Trainer", Set.of(Role.TRAINER));
        createIdentity("Jordan", "Sport", Set.of(Role.SPORT_DIRECTOR));
        facility.createCourt(1, "First court");
        facility.createCourt(2, "Second court");
        Clock firstRun = Clock.fixed(Instant.parse("2026-05-12T10:00:00Z"), ZoneOffset.UTC);
        Clock laterRun = Clock.fixed(Instant.parse("2026-05-26T10:00:00Z"), ZoneOffset.UTC);

        // when
        new UatBookingSeeder(jdbc, transactionManager, firstRun, "UAT",
                "jdbc:postgresql://db:5432/courtside", true).seed();
        List<SeriesRuleRow> before = seriesRules();
        facility.createCourt(3, "Third court");
        UatBookingSeedReport extended = new UatBookingSeeder(jdbc, transactionManager, laterRun, "UAT",
                "jdbc:postgresql://db:5432/courtside", true).seed();

        // then
        assertThat(extended.inserted()).isPositive();
        assertThat(seriesRules()).hasSize(3).allSatisfy(rule -> {
            SeriesRuleRow original = before.stream().filter(candidate -> candidate.id().equals(rule.id()))
                    .findFirst().orElseThrow();
            assertThat(rule.startsOn()).isEqualTo(original.startsOn());
            assertThat(rule.endsOn()).isAfter(original.endsOn());
        });
        assertThat(maximumCourtCount("League match %")).isEqualTo(2);
        assertThat(maximumSeriesCourtCount()).isEqualTo(2);
    }

    @Test
    void givenDisabledOrRestrictedCards_whenSeeding_thenUnavailableKindsAreNotWritten() {
        // given
        createIdentity("Morgan", "Member", Set.of(Role.MEMBER));
        createIdentity("Taylor", "Member", Set.of(Role.MEMBER));
        createIdentity("Jordan", "Member", Set.of(Role.MEMBER));
        createIdentity("Casey", "Member", Set.of(Role.MEMBER));
        facility.createCourt(1, "First court");
        jdbc.sql("UPDATE booking_card SET allowed_player_counts = '{2}', guest_allowed = false "
                + "WHERE id = '11111111-1111-1111-1111-111111111111'").update();
        jdbc.sql("UPDATE participant_card SET active = false "
                + "WHERE id = '55555555-5555-5555-5555-555555555555'").update();
        jdbc.sql("UPDATE booking_card SET allowed_player_counts = '{2}' "
                + "WHERE id = '44444444-4444-4444-4444-444444444444'").update();

        // when
        UatBookingSeedReport report = seeder(true).seed();

        // then
        assertThat(report.unavailable()).contains("doubles", "guest bookings", "ball machine", "court closures");
        assertThat(notes()).anyMatch(note -> note.startsWith("Singles "))
                .noneMatch(note -> note.startsWith("Doubles "))
                .noneMatch(note -> note.startsWith("Guest booking "))
                .noneMatch(note -> note.startsWith("Ball machine "))
                .noneMatch(note -> note.startsWith("Court closure "));
    }

    @Test
    void givenEverySeriesOccurrenceConflicts_whenSeeding_thenNoEmptySeriesIsCreated() {
        // given
        createIdentity("Taylor", "Trainer", Set.of(Role.TRAINER));
        facility.createCourt(1, "First court");
        facility.createCourt(2, "Second court");
        blockEveryPlannedSlot();

        // when
        UatBookingSeedReport report = seeder(true).seed();

        // then
        assertThat(report.conflicts()).isPositive();
        assertThat(tableCount("booking_series")).isZero();
    }

    @Test
    void givenAnyOtherEnvironmentOrDatabase_whenSeeding_thenItRefusesBeforeReadingData() {
        // when / then
        assertThatThrownBy(() -> new UatBookingSeeder(jdbc, transactionManager, clock,
                "PRODUCTION", "jdbc:postgresql://db:5432/courtside", false).seed())
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("only target");
        assertThatThrownBy(() -> new UatBookingSeeder(jdbc, transactionManager, clock,
                "UAT", "jdbc:postgresql://db:5432/courtside_prod", false).seed())
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("only target");
    }

    private UatBookingSeeder seeder(boolean write) {
        return new UatBookingSeeder(jdbc, transactionManager, clock, "UAT",
                "jdbc:postgresql://db:5432/courtside", write);
    }

    private void createIdentity(String firstName, String lastName, Set<Role> roles) {
        UUID personId = identity.createPerson(firstName, lastName);
        identity.createEnabledAccount(personId,
                firstName.toLowerCase() + "." + lastName.toLowerCase(), roles);
        memberships.assignMembership(personId, MEMBERSHIP_TYPE, LocalDate.now(clock).minusYears(1));
    }

    private long tableCount(String table) {
        return jdbc.sql("SELECT count(*) FROM " + table).query(Long.class).single();
    }

    private void createExistingBooking() {
        UUID account = jdbc.sql("SELECT id FROM user_account ORDER BY id LIMIT 1").query(UUID.class).single();
        UUID court = jdbc.sql("SELECT id FROM court ORDER BY number LIMIT 1").query(UUID.class).single();
        Instant start = plannedStart(DayOfWeek.MONDAY, LocalTime.of(10, 0));
        jdbc.sql("""
                INSERT INTO booking (id, card_id, status, booked_by, note, created_at)
                VALUES (:id, '11111111-1111-1111-1111-111111111111', 'CONFIRMED',
                        :account, 'Existing booking', '2024-01-01T09:00:00Z')
                """).param("id", EXISTING_BOOKING).param("account", account).update();
        jdbc.sql("""
                INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                VALUES ('99999999-0000-0000-0000-000000000002', :booking, :court,
                        :startsAt, :endsAt, 'CONFIRMED')
                """).param("booking", EXISTING_BOOKING).param("court", court)
                .param("startsAt", Timestamp.from(start)).param("endsAt", Timestamp.from(start.plusSeconds(3600)))
                .update();
    }

    private Instant plannedStart(DayOfWeek day, LocalTime time) {
        ZoneId zone = ZoneId.of(jdbc.sql("SELECT time_zone FROM club_config LIMIT 1")
                .query(String.class).single());
        LocalDate first = LocalDate.now(clock.withZone(zone)).minusWeeks(8)
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        return ZonedDateTime.of(first.with(TemporalAdjusters.nextOrSame(day)), time, zone).toInstant();
    }

    private void blockEveryPlannedSlot() {
        UUID account = jdbc.sql("SELECT id FROM user_account ORDER BY id LIMIT 1").query(UUID.class).single();
        List<UUID> courts = jdbc.sql("SELECT id FROM court ORDER BY number").query(UUID.class).list();
        ZoneId zone = ZoneId.of(jdbc.sql("SELECT time_zone FROM club_config LIMIT 1")
                .query(String.class).single());
        LocalDate first = LocalDate.now(clock.withZone(zone)).minusWeeks(8)
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate last = LocalDate.now(clock.withZone(zone)).plusWeeks(12)
                .with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY));
        UUID booking = UUID.nameUUIDFromBytes("blocking-booking".getBytes(StandardCharsets.UTF_8));
        jdbc.sql("""
                INSERT INTO booking (id, card_id, status, booked_by, note, created_at)
                VALUES (:id, '11111111-1111-1111-1111-111111111111', 'CONFIRMED',
                        :account, 'Existing blocker', '2024-01-01T09:00:00Z')
                """).param("id", booking).param("account", account).update();
        Instant start = ZonedDateTime.of(first, LocalTime.MIN, zone).toInstant();
        Instant end = ZonedDateTime.of(last.plusDays(1), LocalTime.MIN, zone).toInstant();
        for (int position = 0; position < courts.size(); position++) {
            jdbc.sql("""
                    INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                    VALUES (:id, :booking, :court, :startsAt, :endsAt, 'CONFIRMED')
                    """).param("id", UUID.nameUUIDFromBytes(
                            ("blocking-allocation-" + position).getBytes(StandardCharsets.UTF_8)))
                    .param("booking", booking).param("court", courts.get(position))
                    .param("startsAt", Timestamp.from(start)).param("endsAt", Timestamp.from(end)).update();
        }
    }

    private long seededBookings() {
        return jdbc.sql("SELECT count(*) FROM booking WHERE note LIKE :marker")
                .param("marker", "%" + UatBookingSeeder.MARKER + "%").query(Long.class).single();
    }

    private List<String> notes() {
        return jdbc.sql("SELECT note FROM booking WHERE note LIKE :marker ORDER BY note")
                .param("marker", "%" + UatBookingSeeder.MARKER + "%").query(String.class).list();
    }

    private List<String> roleRows() {
        return jdbc.sql("""
                SELECT user_account_id || ':' || role FROM user_account_role
                ORDER BY user_account_id, role
                """).query(String.class).list();
    }

    private long seedCountBefore(java.time.Instant instant) {
        return seedCount("a.starts_at < :instant", instant);
    }

    private long seedCountAfter(java.time.Instant instant) {
        return seedCount("a.starts_at > :instant", instant);
    }

    private long seedCount(String predicate, java.time.Instant instant) {
        return jdbc.sql("""
                SELECT count(DISTINCT b.id) FROM booking b
                JOIN court_allocation a ON a.booking_id = b.id
                WHERE b.note LIKE :marker AND
                """ + predicate)
                .param("marker", "%" + UatBookingSeeder.MARKER + "%")
                .param("instant", Timestamp.from(instant)).query(Long.class).single();
    }

    private long maximumCourtCount(String note) {
        return jdbc.sql("""
                SELECT max(court_count) FROM (
                    SELECT count(*) AS court_count FROM booking b
                    JOIN court_allocation a ON a.booking_id = b.id
                    WHERE b.note LIKE :note GROUP BY b.id
                ) counts
                """).param("note", note).query(Long.class).single();
    }

    private List<SeriesRuleRow> seriesRules() {
        return jdbc.sql("""
                SELECT id, starts_on, ends_on FROM booking_series ORDER BY id
                """).query((rs, row) -> new SeriesRuleRow(rs.getObject(1, UUID.class),
                        rs.getObject(2, LocalDate.class), rs.getObject(3, LocalDate.class))).list();
    }

    private long maximumSeriesCourtCount() {
        return jdbc.sql("""
                SELECT max(court_count) FROM (
                    SELECT count(*) AS court_count FROM booking_series_court GROUP BY booking_series_id
                ) counts
                """).query(Long.class).single();
    }

    private record SeriesRuleRow(UUID id, LocalDate startsOn, LocalDate endsOn) { }
}
