package org.courtside.uatseed;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Component
@Profile("uat-seed")
class UatBookingSeeder {

    static final String MARKER = "[uat-booking-seed:v1:";
    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID LEAGUE_CARD = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID CLOSURE_CARD = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID BALL_MACHINE = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final long GRID_LOCK = 0x434f555254534944L;

    private final JdbcClient jdbc;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final String environment;
    private final String datasourceUrl;
    private final boolean write;

    UatBookingSeeder(JdbcClient jdbc, PlatformTransactionManager transactionManager, Clock clock,
                     @Value("${courtside.environment:}") String environment,
                     @Value("${spring.datasource.url:}") String datasourceUrl,
                     @Value("${courtside.uat-booking-seed.write:false}") boolean write) {
        this.jdbc = jdbc;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
        this.environment = environment;
        this.datasourceUrl = datasourceUrl;
        this.write = write;
    }

    UatBookingSeedReport seed() {
        requireUat();
        return transactions.execute(status -> seedTransaction());
    }

    private UatBookingSeedReport seedTransaction() {
        jdbc.sql("SELECT pg_advisory_xact_lock(:key)").param("key", GRID_LOCK).query().listOfRows();
        lockBookingGrid();
        lockParticipantCards();
        ZoneId zone = clubZone();
        LocalDate today = LocalDate.now(clock.withZone(zone));
        LocalDate first = today.minusWeeks(8).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate last = today.plusWeeks(12).with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY));
        List<UUID> courts = activeCourts();
        List<MemberIdentity> members = currentMembers();
        List<SeedBooking> plan = new ArrayList<>();
        List<SeriesPlan> series = new ArrayList<>();
        Set<String> unavailable = new LinkedHashSet<>();

        addManagedSeries(plan, series, unavailable, "training-tue", "Training", TRAINING_CARD,
                first.with(TemporalAdjusters.nextOrSame(DayOfWeek.TUESDAY)), last, 1,
                LocalTime.of(18, 0), Duration.ofHours(2), courts, 2, zone);
        addManagedSeries(plan, series, unavailable, "training-thu", "Training", TRAINING_CARD,
                first.with(TemporalAdjusters.nextOrSame(DayOfWeek.THURSDAY)), last, 1,
                LocalTime.of(18, 0), Duration.ofHours(2), courts, 2, zone);
        addManagedSeries(plan, series, unavailable, "league-sat", "League match", LEAGUE_CARD,
                first.with(TemporalAdjusters.nextOrSame(DayOfWeek.SATURDAY)), last, 2,
                LocalTime.of(10, 0), Duration.ofHours(6), courts, Integer.MAX_VALUE, zone);
        addClosures(plan, unavailable, first, last, courts, zone);
        addMemberBookings(plan, unavailable, first, last, courts, members, zone);

        int inserted = 0;
        int existing = 0;
        int conflicts = 0;
        List<BookingAssessment> assessments = new ArrayList<>();
        for (SeedBooking booking : plan) {
            if (exists(booking.id())) {
                existing++;
                assessments.add(new BookingAssessment(booking, BookingState.EXISTING));
            } else if (conflicts(booking)) {
                conflicts++;
                assessments.add(new BookingAssessment(booking, BookingState.CONFLICT));
            } else {
                assessments.add(new BookingAssessment(booking, BookingState.INSERTABLE));
            }
        }
        if (write) {
            for (SeriesPlan recurrence : series) {
                boolean retainedOccurrence = assessments.stream().anyMatch(assessment ->
                        recurrence.id().equals(assessment.booking().seriesId())
                                && assessment.state() != BookingState.CONFLICT);
                if (retainedOccurrence) {
                    ensureSeries(recurrence);
                }
            }
            for (BookingAssessment assessment : assessments) {
                if (assessment.state() == BookingState.INSERTABLE) {
                    insert(assessment.booking());
                    inserted++;
                }
            }
        }
        return new UatBookingSeedReport(write, plan.size(), inserted, existing, conflicts,
                List.copyOf(unavailable));
    }

    private void addManagedSeries(List<SeedBooking> plan, List<SeriesPlan> series,
                                  Set<String> unavailable, String key, String label,
                                  UUID cardId, LocalDate first, LocalDate last,
                                  int intervalWeeks, LocalTime time, Duration duration,
                                  List<UUID> activeCourts, int maximumCourts, ZoneId zone) {
        Account booker = permittedAccount(cardId, false);
        UUID seriesId = stableId("series-" + key);
        String note = label + " " + marker("series-" + key);
        Optional<ExistingSeries> existing = existingSeries(seriesId, note);
        List<UUID> courts = existing.map(ExistingSeries::courts)
                .orElseGet(() -> activeCourts.stream().limit(maximumCourts).toList());
        if (booker == null || !noPlayerCardAvailable(cardId) || courts.isEmpty()
                || !activeCourts.containsAll(courts)
                || (cardId.equals(TRAINING_CARD) && courts.size() < 2)) {
            unavailable.add(label.toLowerCase(Locale.ROOT));
            return;
        }
        LocalDate anchor = existing.map(ExistingSeries::startsOn).orElse(first);
        LocalDate plannedFirst = anchor;
        while (plannedFirst.isBefore(first)) {
            plannedFirst = plannedFirst.plusWeeks(intervalWeeks);
        }
        for (LocalDate date = plannedFirst; !date.isAfter(last); date = date.plusWeeks(intervalWeeks)) {
            plan.add(booking(key + "-" + date, label, cardId, booker.accountId(), seriesId,
                    date, time, duration, courts, List.of(), zone));
        }
        series.add(new SeriesPlan(seriesId, cardId, anchor, last, time, duration,
                intervalWeeks, note, booker.accountId(), courts));
    }

    private void addClosures(List<SeedBooking> plan, Set<String> unavailable, LocalDate first,
                             LocalDate last, List<UUID> courts, ZoneId zone) {
        Account booker = permittedAccount(CLOSURE_CARD, false);
        if (booker == null || !noPlayerCardAvailable(CLOSURE_CARD) || courts.isEmpty()) {
            unavailable.add("court closures");
            return;
        }
        int index = 0;
        for (LocalDate date = first.with(TemporalAdjusters.nextOrSame(DayOfWeek.WEDNESDAY));
             !date.isAfter(last); date = date.plusWeeks(4)) {
            UUID court = courts.get(index++ % courts.size());
            plan.add(booking("closure-" + date, "Court closure", CLOSURE_CARD, booker.accountId(),
                    null, date, LocalTime.of(8, 0), Duration.ofHours(2), List.of(court), List.of(), zone));
        }
    }

    private void addMemberBookings(List<SeedBooking> plan, Set<String> unavailable, LocalDate first,
                                   LocalDate last, List<UUID> courts, List<MemberIdentity> members,
                                   ZoneId zone) {
        Account booker = permittedAccount(MEMBER_CARD, true);
        BookingCardCapabilities card = bookingCard(MEMBER_CARD);
        if (booker == null || courts.isEmpty() || members.size() < 4) {
            unavailable.add("member bookings (four current members and an enabled member account required)");
            return;
        }
        List<MemberIdentity> rotated = rotateOwnerFirst(members, booker.personId());
        for (LocalDate week = first; !week.isAfter(last); week = week.plusWeeks(1)) {
            int offset = (int) ((week.toEpochDay() - first.toEpochDay()) / 7);
            UUID court = courts.get(Math.floorMod(offset, courts.size()));
            if (card.allowsTwo()) {
                addMemberBooking(plan, "singles", "Singles", week, DayOfWeek.MONDAY,
                        LocalTime.of(10, 0), court, booker,
                        List.of(member(rotated.get(0)), member(rotated.get(1))), zone);
                if (participantCardActive(BALL_MACHINE)) {
                    addMemberBooking(plan, "ball-machine", "Ball machine", week, DayOfWeek.SUNDAY,
                            LocalTime.of(17, 0), court, booker,
                            List.of(member(rotated.get(0)), Participant.card(BALL_MACHINE)), zone);
                } else {
                    unavailable.add("ball machine");
                }
            } else {
                unavailable.add("singles");
                unavailable.add("ball machine");
            }
            if (card.allowsFour()) {
                addMemberBooking(plan, "doubles", "Doubles", week, DayOfWeek.WEDNESDAY,
                        LocalTime.of(14, 0), court, booker,
                        rotated.stream().limit(4).map(this::member).toList(), zone);
            } else {
                unavailable.add("doubles");
            }
            if (card.allowsTwo() && card.guestAllowed()) {
                addMemberBooking(plan, "guest", "Guest booking", week, DayOfWeek.FRIDAY,
                        LocalTime.of(16, 0), court, booker,
                        List.of(member(rotated.get(0)), Participant.guest("Sample Guest")), zone);
            } else {
                unavailable.add("guest bookings");
            }
        }
    }

    private void addMemberBooking(List<SeedBooking> plan, String kind, String label, LocalDate week,
                                  DayOfWeek day, LocalTime time, UUID court, Account booker,
                                  List<Participant> participants, ZoneId zone) {
        LocalDate date = week.with(TemporalAdjusters.nextOrSame(day));
        String key = kind + "-" + date;
        plan.add(booking(key, label, MEMBER_CARD, booker.accountId(), null, date, time,
                Duration.ofHours(1), List.of(court), participants, zone));
    }

    private SeedBooking booking(String key, String label, UUID cardId, UUID booker, UUID seriesId,
                                LocalDate date, LocalTime time, Duration duration, List<UUID> courts,
                                List<Participant> participants, ZoneId zone) {
        Instant startsAt = ZonedDateTime.of(date, time, zone).toInstant();
        return new SeedBooking(stableId("booking-" + key), cardId, booker,
                label + " " + marker(key), seriesId, startsAt, startsAt.plus(duration), courts, participants);
    }

    private Account permittedAccount(UUID cardId, boolean currentMemberRequired) {
        String membership = currentMemberRequired
                ? "JOIN member m ON m.person_id = ua.person_id AND m.ended_on IS NULL\n"
                : "LEFT JOIN member m ON false\n";
        return jdbc.sql("""
                SELECT ua.id, ua.person_id
                FROM user_account ua
                """ + membership + """
                JOIN booking_card card ON card.id = :cardId AND card.active = true
                WHERE ua.enabled = true
                  AND (EXISTS (SELECT 1 FROM user_account_role admin_role
                               WHERE admin_role.user_account_id = ua.id AND admin_role.role = 'ADMIN')
                       OR NOT EXISTS (SELECT 1 FROM booking_card_allowed_role allowed
                                      WHERE allowed.booking_card_id = :cardId)
                       OR EXISTS (SELECT 1 FROM user_account_role account_role
                                  JOIN booking_card_allowed_role allowed ON allowed.role = account_role.role
                                  WHERE account_role.user_account_id = ua.id
                                    AND allowed.booking_card_id = :cardId))
                ORDER BY ua.id
                LIMIT 1
                """).param("cardId", cardId).query((rs, row) ->
                new Account(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class))).optional().orElse(null);
    }

    private List<MemberIdentity> currentMembers() {
        return jdbc.sql("""
                SELECT DISTINCT m.person_id
                FROM member m
                WHERE m.ended_on IS NULL
                ORDER BY m.person_id
                """).query(UUID.class).list().stream().map(MemberIdentity::new).toList();
    }

    private List<MemberIdentity> rotateOwnerFirst(List<MemberIdentity> members, UUID owner) {
        List<MemberIdentity> result = new ArrayList<>(members);
        result.sort((left, right) -> Boolean.compare(!left.personId().equals(owner), !right.personId().equals(owner)));
        return result;
    }

    private List<UUID> activeCourts() {
        return jdbc.sql("SELECT id FROM court WHERE active = true ORDER BY number").query(UUID.class).list();
    }

    private ZoneId clubZone() {
        return ZoneId.of(jdbc.sql("SELECT time_zone FROM club_config LIMIT 1").query(String.class).single());
    }

    private boolean exists(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM booking WHERE id = :id)")
                .param("id", id).query(Boolean.class).single();
    }

    private boolean seriesExists(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM booking_series WHERE id = :id)")
                .param("id", id).query(Boolean.class).single();
    }

    private Optional<ExistingSeries> existingSeries(UUID id, String note) {
        Optional<LocalDate> startsOn = jdbc.sql(
                        "SELECT starts_on FROM booking_series WHERE id = :id AND note = :note")
                .param("id", id).param("note", note).query(LocalDate.class).optional();
        return startsOn.map(start -> new ExistingSeries(start, jdbc.sql("""
                SELECT court_id FROM booking_series_court
                WHERE booking_series_id = :id ORDER BY position
                """).param("id", id).query(UUID.class).list()));
    }

    private boolean noPlayerCardAvailable(UUID id) {
        return jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM booking_card
                               WHERE id = :id AND active = true
                                 AND cardinality(allowed_player_counts) = 0)
                """).param("id", id).query(Boolean.class).single();
    }

    private BookingCardCapabilities bookingCard(UUID id) {
        return jdbc.sql("""
                SELECT 2 = ANY(allowed_player_counts), 4 = ANY(allowed_player_counts), guest_allowed
                FROM booking_card WHERE id = :id AND active = true
                """).param("id", id).query((rs, row) -> new BookingCardCapabilities(
                        rs.getBoolean(1), rs.getBoolean(2), rs.getBoolean(3))).optional()
                .orElse(new BookingCardCapabilities(false, false, false));
    }

    private boolean participantCardActive(UUID id) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM participant_card WHERE id = :id AND active = true)")
                .param("id", id).query(Boolean.class).single();
    }

    private void lockBookingGrid() {
        jdbc.sql("SELECT id FROM club_config ORDER BY id FOR UPDATE").query().listOfRows();
    }

    private void lockParticipantCards() {
        jdbc.sql("SELECT id FROM participant_card WHERE id = :id ORDER BY id FOR UPDATE")
                .param("id", BALL_MACHINE).query().listOfRows();
    }

    private boolean conflicts(SeedBooking booking) {
        boolean courtConflict = jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM court_allocation
                    WHERE court_id IN (:courtIds) AND status = 'CONFIRMED'
                      AND starts_at < :endsAt AND ends_at > :startsAt
                )
                """).param("courtIds", booking.courts()).param("startsAt", Timestamp.from(booking.startsAt()))
                .param("endsAt", Timestamp.from(booking.endsAt())).query(Boolean.class).single();
        return courtConflict || booking.participants().stream()
                .filter(participant -> participant.cardId() != null)
                .anyMatch(participant -> participantCardConflict(participant.cardId(), booking));
    }

    private boolean participantCardConflict(UUID cardId, SeedBooking booking) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM participant_card card
                    JOIN booking_participant participant ON participant.card_id = card.id
                    JOIN booking existing_booking ON existing_booking.id = participant.booking_id
                    JOIN court_allocation allocation ON allocation.booking_id = existing_booking.id
                    WHERE card.id = :cardId AND card.capacity IS NOT NULL
                      AND existing_booking.status = 'CONFIRMED' AND allocation.status = 'CONFIRMED'
                      AND allocation.starts_at < :endsAt AND allocation.ends_at > :startsAt
                    GROUP BY card.capacity
                    HAVING count(DISTINCT existing_booking.id) >= card.capacity
                )
                """).param("cardId", cardId).param("startsAt", Timestamp.from(booking.startsAt()))
                .param("endsAt", Timestamp.from(booking.endsAt())).query(Boolean.class).single();
    }

    private void insert(SeedBooking booking) {
        jdbc.sql("""
                INSERT INTO booking (id, card_id, status, booked_by, note, created_at, series_id)
                VALUES (:id, :cardId, 'CONFIRMED', :bookedBy, :note, :createdAt, :seriesId)
                """).param("id", booking.id()).param("cardId", booking.cardId())
                .param("bookedBy", booking.bookedBy()).param("note", booking.note())
                .param("createdAt", Timestamp.from(clock.instant())).param("seriesId", booking.seriesId()).update();
        int position = 0;
        for (UUID court : booking.courts()) {
            jdbc.sql("""
                    INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                    VALUES (:id, :bookingId, :courtId, :startsAt, :endsAt, 'CONFIRMED')
                    """).param("id", stableId("allocation-" + booking.id() + "-" + position++))
                    .param("bookingId", booking.id()).param("courtId", court)
                    .param("startsAt", Timestamp.from(booking.startsAt()))
                    .param("endsAt", Timestamp.from(booking.endsAt())).update();
        }
        position = 1;
        for (Participant participant : booking.participants()) {
            jdbc.sql("""
                    INSERT INTO booking_participant
                        (id, booking_id, kind, person_id, guest_name, card_id, position)
                    VALUES (:id, :bookingId, :kind, :personId, :guestName, :cardId, :position)
                    """).param("id", stableId("participant-" + booking.id() + "-" + position))
                    .param("bookingId", booking.id()).param("kind", participant.kind())
                    .param("personId", participant.personId()).param("guestName", participant.guestName())
                    .param("cardId", participant.cardId()).param("position", position++).update();
        }
    }

    private void ensureSeries(SeriesPlan series) {
        int updated = jdbc.sql("""
                UPDATE booking_series SET ends_on = GREATEST(ends_on, :endsOn), occurrence_count = NULL
                WHERE id = :id AND note = :note
                """).param("endsOn", series.endsOn()).param("id", series.id())
                .param("note", series.note()).update();
        if (updated == 0) {
            if (seriesExists(series.id())) {
                throw new IllegalStateException("Stable UAT series identifier is already in use");
            }
            insertSeries(series);
        }
    }

    private void insertSeries(SeriesPlan series) {
        jdbc.sql("""
                INSERT INTO booking_series
                    (id, card_id, starts_on, start_time, duration_minutes, interval_weeks,
                     weekdays, ends_on, note, created_by, created_at)
                VALUES (:id, :cardId, :startsOn, :startTime, :duration, :interval,
                        ARRAY[:weekday]::smallint[], :endsOn, :note, :creator, :createdAt)
                """).param("id", series.id()).param("cardId", series.cardId())
                .param("startsOn", series.startsOn()).param("startTime", series.time())
                .param("duration", series.duration().toMinutes()).param("interval", series.intervalWeeks())
                .param("weekday", series.startsOn().getDayOfWeek().getValue())
                .param("endsOn", series.endsOn()).param("note", series.note())
                .param("creator", series.creator())
                .param("createdAt", Timestamp.from(clock.instant())).update();
        for (int position = 0; position < series.courts().size(); position++) {
            jdbc.sql("""
                    INSERT INTO booking_series_court (booking_series_id, court_id, position)
                    VALUES (:seriesId, :courtId, :position)
                    """).param("seriesId", series.id()).param("courtId", series.courts().get(position))
                    .param("position", position).update();
        }
    }

    private Participant member(MemberIdentity member) {
        return Participant.member(member.personId());
    }

    private String marker(String key) {
        return MARKER + key + "]";
    }

    private UUID stableId(String key) {
        return UUID.nameUUIDFromBytes((MARKER + key).getBytes(StandardCharsets.UTF_8));
    }

    private void requireUat() {
        if (!"UAT".equals(environment)
                || !datasourceUrl.matches("jdbc:postgresql://db(?::5432)?/courtside(?:\\?.*)?")) {
            throw new IllegalStateException(
                    "UAT booking data may only target jdbc:postgresql://db:5432/courtside "
                            + "with COURTSIDE_ENVIRONMENT=UAT");
        }
    }

    private record Account(UUID accountId, UUID personId) { }

    private record MemberIdentity(UUID personId) { }

    private record BookingCardCapabilities(boolean allowsTwo, boolean allowsFour,
                                           boolean guestAllowed) { }

    private record SeriesPlan(UUID id, UUID cardId, LocalDate startsOn, LocalDate endsOn,
                              LocalTime time, Duration duration, int intervalWeeks, String note,
                              UUID creator, List<UUID> courts) { }

    private record ExistingSeries(LocalDate startsOn, List<UUID> courts) { }

    private enum BookingState { EXISTING, CONFLICT, INSERTABLE }

    private record BookingAssessment(SeedBooking booking, BookingState state) { }

    private record Participant(String kind, UUID personId, String guestName, UUID cardId) {
        static Participant member(UUID personId) {
            return new Participant("MEMBER", personId, null, null);
        }

        static Participant guest(String name) {
            return new Participant("GUEST", null, name, null);
        }

        static Participant card(UUID cardId) {
            return new Participant("CARD", null, null, cardId);
        }
    }

    private record SeedBooking(UUID id, UUID cardId, UUID bookedBy, String note, UUID seriesId,
                               Instant startsAt, Instant endsAt, List<UUID> courts,
                               List<Participant> participants) { }
}
