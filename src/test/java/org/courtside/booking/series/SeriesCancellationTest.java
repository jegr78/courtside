package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.BookingNotOwnedException;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.jdbc.core.simple.JdbcClient;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
class SeriesCancellationTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private JdbcClient jdbc;

    private UUID courtOne;
    private final UUID trainer = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        courtOne = courts.save(new Court(1, "Court 1")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void givenFiveOccurrences_whenCancellingOnlyThisOne_thenExactlyOneIsCancelled() {
        // given
        SeriesCreationResult result = createSeries(5);

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().get(2),
                CancelScope.THIS, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(1);
        assertThat(statusesOf(result)).containsExactly(
                BookingStatus.CONFIRMED, BookingStatus.CONFIRMED, BookingStatus.CANCELLED,
                BookingStatus.CONFIRMED, BookingStatus.CONFIRMED);
    }

    @Test
    void givenFiveOccurrences_whenCancellingThisAndFollowing_thenTheTailIsCancelled() {
        // given
        SeriesCreationResult result = createSeries(5);

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().get(2),
                CancelScope.THIS_AND_FOLLOWING, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(3);
        assertThat(statusesOf(result)).containsExactly(
                BookingStatus.CONFIRMED, BookingStatus.CONFIRMED, BookingStatus.CANCELLED,
                BookingStatus.CANCELLED, BookingStatus.CANCELLED);
    }

    @Test
    void givenFiveOccurrences_whenCancellingTheWholeSeries_thenAllAreCancelled() {
        // given
        SeriesCreationResult result = createSeries(5);

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().get(2),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(5);
        assertThat(statusesOf(result)).allMatch(BookingStatus.CANCELLED::equals);
    }

    @Test
    void givenATrainingSeriesCreatedByATrainer_whenAYouthDirectorCancels_thenTheActorIsRecorded() {
        // given
        SeriesCreationResult result = createSeries(2);
        UUID youthDirector = UUID.randomUUID();

        // when
        seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, youthDirector, Set.of(Role.YOUTH_DIRECTOR));

        // then
        assertThat(result.bookingIds()).allSatisfy(bookingId ->
                assertThat(bookings.findById(bookingId).orElseThrow().getCancelledBy())
                        .isEqualTo(youthDirector));
    }

    @Test
    void givenAnAlreadyCancelledOccurrence_whenCancellingTheSeries_thenItIsNotCountedTwice() {
        // given
        SeriesCreationResult result = createSeries(3);
        seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.THIS, trainer, Set.of(Role.TRAINER));

        // when
        int cancelled = seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isEqualTo(2);
    }

    @Test
    void givenAnUnknownSeries_whenCancelling_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> seriesService.cancel(UUID.randomUUID(), UUID.randomUUID(),
                CancelScope.THIS, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(SeriesNotFoundException.class);
    }

    @Test
    void givenAnUnrelatedBookingId_whenCancellingThisAndFollowing_thenItIsRejected() {
        // given
        SeriesCreationResult result = createSeries(3);

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), UUID.randomUUID(),
                CancelScope.THIS_AND_FOLLOWING, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(SeriesRequestInvalidException.class);
    }

    @Test
    void givenAnUnrelatedBookingId_whenCancellingTheWholeSeries_thenItIsRejected() {
        // given
        SeriesCreationResult result = createSeries(3);

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), UUID.randomUUID(),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(SeriesRequestInvalidException.class);
    }

    @Test
    void givenAMiddleOccurrenceUsesAnUnauthorizedCard_whenCancellingTheWholeSeries_thenNothingIsCancelled() {
        // given
        SeriesCreationResult result = createSeries(3);
        jdbc.sql("UPDATE booking SET booked_by = ?, card_id = ? WHERE id = ?")
                .params(UUID.randomUUID(), UUID.fromString("44444444-4444-4444-4444-444444444444"),
                        result.bookingIds().get(1))
                .update();

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), result.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(BookingNotOwnedException.class);
        assertThat(statusesOf(result)).allMatch(BookingStatus.CONFIRMED::equals);
    }

    @Test
    void givenACancelledOccurrenceOfAnotherAccountsSeries_whenCancellingIt_thenAccessIsRefused() {
        // given
        SeriesCreationResult result = createSeries(2);
        UUID cancelledOccurrence = result.bookingIds().getFirst();
        seriesService.cancel(result.seriesId(), cancelledOccurrence, CancelScope.THIS,
                trainer, Set.of(Role.TRAINER));

        // when / then
        assertThatThrownBy(() -> seriesService.cancel(result.seriesId(), cancelledOccurrence,
                CancelScope.THIS, UUID.randomUUID(), Set.of(Role.MEMBER)))
                .isInstanceOf(BookingNotOwnedException.class);
    }

    private List<BookingStatus> statusesOf(SeriesCreationResult result) {
        return result.bookingIds().stream()
                .map(id -> bookings.findById(id).orElseThrow().getStatus())
                .toList();
    }

    private SeriesPreview previewAsTrainer(SeriesRule rule) {
        return seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER));
    }

    private SeriesCreationResult createSeries(int count) {
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, count);
        List<Instant> starts = previewAsTrainer(rule).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
        return seriesService.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training");
    }
}
