package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.booking.internal.CardNotBookableException;
import org.courtside.facility.CourtNotBookableException;
import org.courtside.booking.BookingService;
import org.courtside.booking.internal.CourtAllocationRepository;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.courtside.rules.RuleViolation;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verifyNoInteractions;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Import(FacilityTestFixture.class)
class SeriesPreviewTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID RETIRED_CARD =
            UUID.fromString("99999999-9999-9999-9999-999999999999");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @MockitoSpyBean
    private CourtAllocationRepository allocations;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtOne;
    private UUID courtTwo;
    private final UUID trainer = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        courtOne = facilityFixture.createCourt(1, "Court 1");
        courtTwo = facilityFixture.createCourt(2, "Court 2");

        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    // booking_card holds the seed and survives the shared teardown.
    @AfterEach
    void removeTheRetiredCard() {
        jdbc.sql("DELETE FROM booking_card WHERE id = ?").param(RETIRED_CARD).update();
    }

    @Test
    void givenAnEmptyCalendar_whenPreviewingFourOccurrences_thenNoneIsBlocked() {
        // when
        SeriesPreview preview = previewAsTrainer(rule(4));

        // then
        assertThat(preview.occurrences()).hasSize(4);
        assertThat(preview.occurrences()).allMatch(SeriesPreview.Occurrence::isCreatable);
    }

    @Test
    void givenOneCourtTakenOnTheSecondDate_whenPreviewing_thenOnlyThatOccurrenceIsBlocked() {
        // given
        bookingService.create(new CreateBookingCommand(
                List.of(courtTwo), TRAINING_CARD,
                new TimeSlot(Instant.parse("2026-04-14T16:00:00Z"),
                             Instant.parse("2026-04-14T18:00:00Z")),
                UUID.randomUUID(), null, Set.of(Role.TRAINER), null, List.of(), null));

        // when
        SeriesPreview preview = previewAsTrainer(rule(4));

        // then
        assertThat(preview.occurrences()).extracting(SeriesPreview.Occurrence::isCreatable)
                .containsExactly(true, false, true, true);
        assertThat(preview.occurrences().get(1).blockedCourtIds()).containsExactly(courtTwo);
    }

    @Test
    void givenACancelledBookingOnTheDate_whenPreviewing_thenTheCourtIsFree() {
        // given
        UUID bookingId = bookingService.create(new CreateBookingCommand(
                List.of(courtTwo), TRAINING_CARD,
                new TimeSlot(Instant.parse("2026-04-14T16:00:00Z"),
                             Instant.parse("2026-04-14T18:00:00Z")),
                UUID.randomUUID(), null, Set.of(Role.TRAINER), null, List.of(), null));
        bookingService.cancel(bookingId, UUID.randomUUID(), Set.of(Role.ADMIN));

        // when
        SeriesPreview preview = previewAsTrainer(rule(4));

        // then
        assertThat(preview.occurrences()).allMatch(SeriesPreview.Occurrence::isCreatable);
    }

    @Test
    void givenEveryOccurrenceRunsPastClosingTime_whenPreviewing_thenNoneIsCreatable() {
        // given
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(21, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 4);

        // when
        SeriesPreview preview = previewAsTrainer(rule);

        // then
        assertThat(preview.creatableCount()).isZero();
        assertThat(preview.occurrences()).allSatisfy(occurrence ->
                assertThat(occurrence.violations()).extracting(RuleViolation::code)
                        .containsExactly("booking.rule.openingHours.outside"));
    }

    @Test
    void givenEveryOccurrenceStartsBesideTheGrid_whenPreviewing_thenNoneIsCreatable() {
        // given
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 15), 45,
                1, Set.of(DayOfWeek.TUESDAY), null, 3);

        // when
        SeriesPreview preview = previewAsTrainer(rule);

        // then
        assertThat(preview.creatableCount()).isZero();
        assertThat(preview.occurrences()).allSatisfy(occurrence ->
                assertThat(occurrence.violations()).extracting(RuleViolation::code)
                        .containsExactly("booking.rule.slotGrid.misaligned"));
    }

    @Test
    void givenARuleExpandingPastTheOccurrenceLimit_whenPreviewing_thenItIsRejectedBeforeAnyCalendarQuery() {
        // given
        SeriesRule rule = everyDayUntil(LocalDate.of(2026, 10, 24));

        // when / then
        assertThatThrownBy(() -> previewAsTrainer(rule))
                .isInstanceOf(SeriesRequestInvalidException.class)
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.type(
                        SeriesRequestInvalidException.class))
                .satisfies(failure -> {
                    assertThat(failure.getCode()).isEqualTo("booking.series.tooManyOccurrences");
                    assertThat(failure.getParams())
                            .containsEntry("limit", 200)
                            .containsEntry("requested", 201);
                });
        verifyNoInteractions(allocations);
    }

    @Test
    void givenARuleExpandingToExactlyTheOccurrenceLimit_whenPreviewing_thenItIsStillOffered() {
        // given
        SeriesRule rule = everyDayUntil(LocalDate.of(2026, 10, 23));

        // when
        SeriesPreview preview = previewAsTrainer(rule);

        // then
        assertThat(preview.occurrences()).hasSize(200);
    }

    @Test
    void givenARuleExpandingPastTheOccurrenceLimit_whenCreating_thenItIsRejected() {
        // given
        SeriesRule rule = everyDayUntil(LocalDate.of(2026, 10, 24));

        // when / then
        assertThatThrownBy(() -> seriesService.create(rule,
                List.of(Instant.parse("2026-04-07T16:00:00Z")), UUID.randomUUID(), null,
                Set.of(Role.TRAINER), "Team training"))
                .isInstanceOf(SeriesRequestInvalidException.class);
    }

    @Test
    void givenOneOfTheCourtsIsInactive_whenPreviewing_thenItIsRejectedAsCreateWould() {
        // given
        facilityFixture.deactivateCourt(courtTwo);

        // when / then
        assertThatThrownBy(() -> previewAsTrainer(rule(4)))
                .isInstanceOf(CourtNotBookableException.class)
                .extracting(failure -> ((CourtNotBookableException) failure).getCode())
                .isEqualTo("court.inactive");
    }

    @Test
    void givenAnUnknownCard_whenPreviewing_thenItIsRejectedAsCreateWould() {
        // given
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), UUID.randomUUID(),
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 4);

        // when / then
        assertThatThrownBy(() -> previewAsTrainer(rule))
                .isInstanceOf(CardNotBookableException.class)
                .extracting(failure -> ((CardNotBookableException) failure).getCode())
                .isEqualTo("card.unknown");
    }

    @Test
    void givenAnInactiveCard_whenPreviewing_thenItIsRejectedAsCreateWould() {
        // given
        jdbc.sql("""
                        INSERT INTO booking_card
                            (id, label, color, allowed_player_counts, counts_against_limits,
                             guest_allowed, active)
                        VALUES (?, 'Retired', '#000000', '{}', false, false, false)
                        """)
                .param(RETIRED_CARD)
                .update();
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), RETIRED_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 4);

        // when / then
        assertThatThrownBy(() -> previewAsTrainer(rule))
                .isInstanceOf(CardNotBookableException.class)
                .extracting(failure -> ((CardNotBookableException) failure).getCode())
                .isEqualTo("card.inactive");
    }

    @Test
    void givenACardThatTracksPlayers_whenPreviewing_thenItIsRejected() {
        // given
        SeriesRule rule = new SeriesRule(
                List.of(courtOne, courtTwo), MEMBER_BOOKING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 4);

        // when / then
        assertThatThrownBy(() -> previewAsTrainer(rule))
                .isInstanceOfSatisfying(ParticipantsInvalidException.class, exception ->
                        assertThat(exception.getCode()).isEqualTo("booking.series.cardTracksPlayers"));
    }

    private SeriesPreview previewAsTrainer(SeriesRule rule) {
        return seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER));
    }

    private SeriesRule everyDayUntil(LocalDate endsOn) {
        return new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.values()), endsOn, null);
    }

    private SeriesRule rule(int count) {
        return new SeriesRule(
                List.of(courtOne, courtTwo), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, count);
    }
}
