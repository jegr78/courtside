package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.access.ProbeOutcome;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = {
        "courtside.access-control.connector=simulated",
        "courtside.access-control.call-deadline=500ms",
        "courtside.access-control.insert-page-size=2",
        "courtside.database.lock-timeout=1s"})
@Import({SettablePassClock.Configuration.class, ScriptedAccessControl.Configuration.class,
        FacilityTestFixture.class, IdentityTestFixture.class, BookingTestFixture.class, CardTestFixture.class})
abstract class AccessPassTestSupport extends AbstractIntegrationTest {

    static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    static final Instant START = Instant.parse("2026-05-12T10:00:00Z");
    static final TimeSlot EVENING =
            new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z"));
    static final Instant VALID_UNTIL = Instant.parse("2026-05-12T17:15:00Z");
    static final Duration DEADLINE = Duration.ofMillis(500);

    @Autowired
    AccessPass pass;

    @Autowired
    ScriptedAccessControl connector;

    @Autowired
    SettablePassClock clock;

    @Autowired
    AccessGrantRepository grants;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PlatformTransactionManager transactions;

    @Autowired
    FacilityTestFixture facility;

    @Autowired
    IdentityTestFixture identity;

    @Autowired
    BookingTestFixture bookings;

    @Autowired
    CardTestFixture cards;

    @Autowired
    ProbeReadings readings;

    @Autowired
    AccessReconciliation reconciliation;

    @Autowired
    ConnectionCheckReadings checkReadings;

    List<UUID> courts;
    UUID northGate;
    UUID southGate;
    private UUID jane;
    private UUID janeAccount;

    @BeforeEach
    void aClubWhoseGatesOpenByCode() {
        connector.reset();
        ((AtomicReference<?>) ReflectionTestUtils.getField(readings, "latest")).set(null);
        ((AtomicReference<?>) ReflectionTestUtils.getField(readings, "answeredAt")).set(null);
        ((AtomicReference<?>) ReflectionTestUtils.getField(reconciliation, "lastRunAt")).set(null);
        ((AtomicReference<?>) ReflectionTestUtils.getField(checkReadings, "latest")).set(null);
        checkReadings.takeRequest();
        clock.set(START);
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        courts = List.of(facility.createCourt(1, "Court 1"), facility.createCourt(2, "Court 2"));
        northGate = facility.createAccessPoint("North gate", courts.subList(0, 1), null);
        southGate = facility.createAccessPoint("South gate", courts.subList(1, 2), null);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.ADMIN));
    }

    @AfterEach
    void releaseHangingCalls() {
        connector.releaseStubbornCalls();
    }

    UUID book(UUID court) {
        return book(court, EVENING);
    }

    UUID book(UUID court, TimeSlot slot) {
        UUID partner = identity.createPerson("John", "Roe", "john.roe." + UUID.randomUUID() + "@example.org");
        return bookings.createBookingNamingMember(court, MEMBER_BOOKING_CARD, slot, janeAccount, jane,
                Set.of(Role.MEMBER), null, partner);
    }

    UUID account() {
        return janeAccount;
    }

    UUID person() {
        return jane;
    }

    void cancel(UUID booking) {
        bookings.cancelBooking(booking, janeAccount, Set.of(Role.ADMIN));
    }

    PassResult passAt(Instant at) {
        clock.set(at);
        return pass.runPassNow();
    }

    UUID grantIdOf(UUID booking) {
        return jdbc.sql("SELECT id FROM access_grant WHERE booking_id = ?").params(booking).query(UUID.class)
                .single();
    }

    AccessGrant grantOf(UUID booking) {
        return grants.findById(grantIdOf(booking)).orElseThrow();
    }

    Optional<String> currentCode(UUID booking) {
        return jdbc.sql("SELECT code FROM access_code WHERE grant_id = ?").params(grantIdOf(booking))
                .query(String.class).optional();
    }

    int accessCodes() {
        return jdbc.sql("SELECT count(*) FROM access_code").query(Integer.class).single();
    }

    void insertWithoutCalls() {
        connector.nextProbes(new ScriptedAccessControl.Step.Probe(new ProbeOutcome.Unreachable("connection refused")));
        assertThat(pass.runPassNow()).isEqualTo(new PassResult.Outage());
    }

    void inLockedRow(UUID grantId, Consumer<AccessGrant> change) {
        new TransactionTemplate(transactions).executeWithoutResult(status ->
                change.accept(grants.findLockedById(grantId).orElseThrow()));
    }
}
