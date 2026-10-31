package org.courtside.access.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.config.ClubTimeZone;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.TestPropertySource;

import java.io.IOException;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
@TestPropertySource(properties = {
        "courtside.access-control.connector=simulated",
        "courtside.access-control.call-deadline=10s"})
@Import({LoxoneGrantJourneyTest.Miniserver.class, SettablePassClock.Configuration.class, FacilityTestFixture.class,
        IdentityTestFixture.class, BookingTestFixture.class, CardTestFixture.class})
class LoxoneGrantJourneyTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final Instant START = Instant.parse("2026-05-12T10:00:00Z");

    @TestConfiguration(proxyBeanMethods = false)
    static class Miniserver {

        @Bean(destroyMethod = "close")
        LoxoneSimulator loxoneSimulator(ClubTimeZone zone) throws IOException {
            return new LoxoneSimulator(Clock.systemUTC(), zone.zoneId());
        }

        @Bean
        @Primary
        LoxoneAccessControl loxoneAccessControl(LoxoneSimulator simulator, LoxoneGroupMapping groups,
                                                ClubTimeZone zone) {
            LoxoneSettings simulated = simulator.settingsByUrl(Duration.ofSeconds(10));
            return new LoxoneAccessControl(new LoxoneSettings(simulated.address(), simulated.user(),
                    simulated.password(), zone, simulated.callDeadline()), groups, LoxoneSimulator.clientTrust(),
                    Clock.systemUTC());
        }
    }

    @Autowired
    private AccessPass pass;

    @Autowired
    private SettablePassClock clock;

    @Autowired
    private LoxoneSimulator simulator;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAConfirmedSeriesBehindALoxoneGate_whenItIsMovedAndCancelled_thenTheMiniserverUserFollowsWithoutLeaks(
            CapturedOutput output) {
        // given
        clock.set(START);
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        UUID court = facility.createCourt(1, "Court 1");
        UUID gate = facility.createAccessPoint("North gate", List.of(court), null);
        facility.mapLoxoneGroup(gate, simulator.groupUuid("Court 1"));
        cards.letBookingsReceiveAccessCodes(TRAINING_CARD, true);
        cards.letBookingsReceiveAccessCodes(MEMBER_BOOKING_CARD, true);
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.ADMIN));
        UUID series = bookings.createSeries(court, TRAINING_CARD, LocalDate.of(2026, 5, 12), LocalTime.of(16, 0),
                60, 1, janeAccount, jane, Set.of(Role.ADMIN));
        List<String> codes = new ArrayList<>();

        // when
        pass.runPassNow();
        String name = LoxoneSimulator.nameOf(grantIdOf(bookings.firstOccurrenceOf(series)));
        LoxoneSimulator.User installed = simulator.usersNamed(name).getFirst();
        codes.add(installed.code);
        long installedFrom = installed.validFrom;
        bookings.moveWholeSeries(series, LocalTime.of(18, 0), janeAccount, Set.of(Role.ADMIN));
        clock.set(START.plus(Duration.ofMinutes(1)));
        pass.runPassNow();
        LoxoneSimulator.User moved = simulator.usersNamed(name).getFirst();
        long movedFrom = moved.validFrom;
        long movedUntil = moved.validUntil;
        UUID single = bookings.createBookingNamingMember(court, MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T12:00:00Z"), Instant.parse("2026-05-12T13:00:00Z")),
                janeAccount, jane, Set.of(Role.MEMBER), null,
                identity.createPerson("John", "Roe", "john.roe@example.org"));
        simulator.force("addoredituser", 418);
        clock.set(START.plus(Duration.ofMinutes(2)));
        pass.runPassNow();
        String faultReason = lastFailureOf(grantIdOf(single));
        simulator.release("addoredituser");
        bookings.cancelWholeSeries(series, janeAccount, Set.of(Role.ADMIN));
        clock.set(START.plus(Duration.ofMinutes(3)));
        pass.runPassNow();

        // then
        assertThat(installedFrom).as("16:00 in the club's zone, fifteen minutes ahead")
                .isEqualTo(simulator.loxoneSeconds(Instant.parse("2026-05-12T13:45:00Z")));
        assertThat(moved.uuid).as("a move keeps the user").isEqualTo(installed.uuid);
        assertThat(movedFrom).as("a move to 18:00 opens the user fifteen minutes ahead")
                .isEqualTo(simulator.loxoneSeconds(Instant.parse("2026-05-12T15:45:00Z")));
        assertThat(movedUntil).isEqualTo(simulator.loxoneSeconds(Instant.parse("2026-05-12T17:15:00Z")));
        assertThat(simulator.usersNamed(name)).as("a cancellation removes the user").isEmpty();
        assertThat(faultReason).as("the fault run left a reason").isNotBlank();
        assertThat(simulator.untouchedForeignUsersViolations()).isEmpty();
        List<String> leaks = new ArrayList<>(codes);
        leaks.addAll(jdbc.sql("SELECT code FROM access_code").query(String.class).list());
        leaks.addAll(simulator.issuedTokens());
        leaks.add(LoxoneSimulator.PASSWORD);
        List<String> failures = jdbc.sql("SELECT coalesce(last_failure, '') FROM access_grant")
                .query(String.class).list();
        assertThat(simulator.issuedTokens()).isNotEmpty();
        assertThat(leaks).allSatisfy(secret -> {
            assertThat(output.getOut()).as("no code, token or password reaches a log line").doesNotContain(secret);
            assertThat(failures).as("no code, token or password reaches last_failure")
                    .noneMatch(failure -> failure.contains(secret));
        });
    }

    private UUID grantIdOf(UUID booking) {
        return jdbc.sql("SELECT id FROM access_grant WHERE booking_id = ?").params(booking).query(UUID.class)
                .single();
    }

    private String lastFailureOf(UUID grantId) {
        return jdbc.sql("SELECT coalesce(last_failure, '') FROM access_grant WHERE id = ?").params(grantId)
                .query(String.class).single();
    }
}
