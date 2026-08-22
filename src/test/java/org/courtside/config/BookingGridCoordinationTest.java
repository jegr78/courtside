package org.courtside.config;

import org.courtside.config.BookingSlotDuration;
import org.courtside.config.CredentialLifetime;
import org.courtside.config.internal.ChangeClubConfigurationCommand;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.config.internal.ConfigService;
import org.courtside.facility.FacilityService;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.facility.OpeningHoursGridMismatchException;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Timeout(value = 30, unit = TimeUnit.SECONDS)
@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingGridCoordinationTest extends AbstractIntegrationTest {

    @Autowired
    private BookingGridCoordination coordination;

    @Autowired
    private ConfigService config;

    @Autowired
    private FacilityService facility;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PlatformTransactionManager transactions;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void givenAnInvalidSlotDuration_whenUpdatingThroughTheService_thenTheInvariantIsRejected() {
        // when / then
        assertThatThrownBy(() -> config.update(new ChangeClubConfigurationCommand(
                "Example Tennis Club", "#b85c38", "#d7e24b", null, null, "de",
                new BookingSlotDuration(7), "Europe/Berlin",
                new CredentialLifetime(168), new CredentialLifetime(24))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("five-minute steps");
    }

    @Test
    void givenAnUncommittedGridChange_whenOpeningHoursAreChanged_thenTheWriterWaitsAndRejectsTheOldGrid()
            throws Exception {
        // given
        CountDownLatch gridChanged = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> gridChange = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        coordination.lock();
                        jdbc.sql("""
                                UPDATE club_config SET slot_minutes = 60
                                WHERE id = '00000000-0000-0000-0000-000000000001'
                                """).update();
                        gridChanged.countDown();
                        await(allowCommit);
                    }));
            assertThat(gridChanged.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> openingHoursChange = pool.submit(() -> facility.setOpeningHours(
                    DayOfWeek.MONDAY,
                    new OpeningWindow(LocalTime.of(8, 30), LocalTime.of(20, 30))));

            // then
            assertThatThrownBy(() -> openingHoursChange.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            gridChange.get(5, TimeUnit.SECONDS);
            assertThatThrownBy(() -> openingHoursChange.get(5, TimeUnit.SECONDS))
                    .isInstanceOf(ExecutionException.class)
                    .hasCauseInstanceOf(OpeningHoursGridMismatchException.class);
        } finally {
            allowCommit.countDown();
        }
    }

    @Test
    void givenAnUncommittedTimeZoneChange_whenABookingIsCreated_thenTheWriterWaitsForTheChange()
            throws Exception {
        // given
        UUID courtId = facilityFixture.createCourt(1, "Court 1");
        UUID personId = identity.createPerson("Jane", "Doe", "jane@example.org");
        UUID accountId = UUID.randomUUID();
        facility.setOpeningHours(DayOfWeek.TUESDAY,
                new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        CreateBookingCommand command = new CreateBookingCommand(
                List.of(courtId),
                UUID.fromString("11111111-1111-1111-1111-111111111111"),
                new TimeSlot(Instant.parse("2026-09-15T16:00:00Z"),
                        Instant.parse("2026-09-15T17:00:00Z")),
                accountId, personId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Partner")), null);
        CountDownLatch zoneChanged = new CountDownLatch(1);
        CountDownLatch allowCommit = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> timeZoneChange = pool.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        coordination.lock();
                        jdbc.sql("""
                                UPDATE club_config SET time_zone = 'Pacific/Auckland'
                                WHERE id = '00000000-0000-0000-0000-000000000001'
                                """).update();
                        zoneChanged.countDown();
                        await(allowCommit);
                    }));
            assertThat(zoneChanged.await(5, TimeUnit.SECONDS)).isTrue();

            // when
            Future<?> booking = pool.submit(() -> bookings.create(command));

            // then
            assertThatThrownBy(() -> booking.get(250, TimeUnit.MILLISECONDS))
                    .isInstanceOf(TimeoutException.class);
            allowCommit.countDown();
            timeZoneChange.get(5, TimeUnit.SECONDS);
            assertThatThrownBy(() -> booking.get(5, TimeUnit.SECONDS))
                    .isInstanceOfSatisfying(ExecutionException.class, failure ->
                            assertThat(failure.getCause())
                                    .isInstanceOfSatisfying(BookingRulesViolatedException.class,
                                            rejection -> assertThat(rejection.getViolations())
                                                    .extracting(RuleViolation::code)
                                                    .contains("booking.rule.openingHours.closed")));
        } finally {
            allowCommit.countDown();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out while coordinating concurrent transactions");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while coordinating concurrent transactions", e);
        }
    }
}
