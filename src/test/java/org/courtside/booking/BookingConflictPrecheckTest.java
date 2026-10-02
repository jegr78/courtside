package org.courtside.booking;

import io.micrometer.core.instrument.MeterRegistry;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.internal.CourtUnavailableException;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verify;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingConflictPrecheckTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant START = Instant.parse("2026-05-12T16:00:00Z");
    private static final Instant END = Instant.parse("2026-05-12T17:00:00Z");

    @Autowired
    private BookingService service;

    @MockitoSpyBean
    private BookingRepository bookings;

    @MockitoSpyBean
    private CourtAllocationRepository allocations;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MeterRegistry meters;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactions;

    private UUID court;
    private UUID person;

    @BeforeEach
    void setUp() {
        court = facility.createCourt(1, "Court 1");
        person = identity.createPerson("Jane", "Doe", "jane@example.org");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void givenAnOccupiedCourt_whenCreatingAnotherBooking_thenConflictIsReturnedWithoutAnInsert(boolean idempotent) {
        // given
        service.create(command(START, END));
        clearInvocations(bookings);
        double conflictsBefore = conflicts();

        // when / then
        assertThatThrownBy(() -> {
            if (idempotent) service.create(command(START, END), "different-request");
            else service.create(command(START, END));
        }).isInstanceOf(CourtUnavailableException.class);
        verify(bookings, never()).saveAndFlush(any());
        assertThat(conflicts()).isEqualTo(conflictsBefore + 1);
        assertThat(bookings.count()).isEqualTo(1);
    }

    @Test
    void givenAnOccupiedCourtAndInvalidTime_whenCreating_thenEveryRuleViolationStillPrecedesTheConflict() {
        // given
        service.create(command(START, END));
        clearInvocations(allocations);

        // when / then
        assertThatThrownBy(() -> service.create(command(START.plusSeconds(420), END.plusSeconds(4 * 3600 + 420))))
                .isInstanceOfSatisfying(BookingRulesViolatedException.class, failure ->
                        assertThat(failure.getViolations()).extracting(RuleViolation::code)
                                .contains("booking.rule.openingHours.outside", "booking.rule.slotGrid.misaligned"));
        verify(allocations, never()).existsConfirmedOverlapping(any(), any(), any());
        assertThat(bookings.count()).isEqualTo(1);
    }

    @Test
    void givenAWriteRacingAfterTheAvailabilityRead_whenCreating_thenTheDatabaseConstraintStillRejectsIt() {
        // given
        TransactionTemplate competing = new TransactionTemplate(transactions);
        competing.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        var readOccupiedCourts = mockingDetails(allocations).getMockCreationSettings().getDefaultAnswer();
        doAnswer(invocation -> {
            Object occupied = readOccupiedCourts.answer(invocation);
            assertThat((Boolean) occupied).isFalse();
            competing.executeWithoutResult(status -> insertCompetingAllocation());
            return occupied;
        }).when(allocations).existsConfirmedOverlapping(List.of(court), START, END);
        double conflictsBefore = conflicts();

        // when / then
        assertThatThrownBy(() -> service.create(command(START, END)))
                .isInstanceOf(CourtUnavailableException.class)
                .hasCauseInstanceOf(DataIntegrityViolationException.class)
                .rootCause().hasMessageContaining("court_allocation_no_overlap");
        assertThat(bookings.count()).isEqualTo(1);
        assertThat(conflicts()).isEqualTo(conflictsBefore + 1);
    }

    @Test
    void givenAnOccupiedCourt_whenCheckingRanges_thenTheSameHalfOpenAndCancellationSemanticsApply() {
        // given
        UUID booking = service.create(command(START, END));

        // when
        boolean overlapping = allocations.existsConfirmedOverlapping(List.of(court), START.plusSeconds(1800), END);
        boolean adjacent = allocations.existsConfirmedOverlapping(List.of(court), END, END.plusSeconds(3600));
        boolean anotherCourt = allocations.existsConfirmedOverlapping(List.of(UUID.randomUUID()), START, END);
        boolean multipleCourts = allocations.existsConfirmedOverlapping(List.of(UUID.randomUUID(), court), START, END);
        service.cancel(booking, UUID.randomUUID(), Set.of(Role.ADMIN));
        boolean cancelled = allocations.existsConfirmedOverlapping(List.of(court), START, END);

        // then
        assertThat(overlapping).isTrue();
        assertThat(adjacent).isFalse();
        assertThat(anotherCourt).isFalse();
        assertThat(multipleCourts).isTrue();
        assertThat(cancelled).isFalse();
    }

    private void insertCompetingAllocation() {
        UUID id = UUID.randomUUID();
        jdbc.sql("INSERT INTO booking (id, card_id, status) VALUES (?, ?, 'CONFIRMED')")
                .params(id, MEMBER_CARD).update();
        jdbc.sql("""
                INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                VALUES (?, ?, ?, ?, ?, 'CONFIRMED')
                """)
                .params(UUID.randomUUID(), id, court, START.atOffset(ZoneOffset.UTC), END.atOffset(ZoneOffset.UTC))
                .update();
    }

    private double conflicts() {
        var counter = meters.find("courtside.bookings.conflicts").counter();
        return counter == null ? 0 : counter.count();
    }

    private CreateBookingCommand command(Instant start, Instant end) {
        return new CreateBookingCommand(List.of(court), MEMBER_CARD, new TimeSlot(start, end),
                UUID.randomUUID(), person, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Example Guest")), null);
    }
}
