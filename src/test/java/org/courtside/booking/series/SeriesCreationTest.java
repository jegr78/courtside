package org.courtside.booking.series;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.internal.CardRoleRequiredException;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.ParticipantsInvalidException;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
class SeriesCreationTest extends AbstractIntegrationTest {

    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID STANDARD_MEMBERSHIP =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private SeriesService seriesService;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private BookingSeriesRepository seriesRepository;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private MemberRepository members;

    private UUID courtOne;
    private UUID courtTwo;
    private final UUID trainer = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        courtOne = courts.save(new Court(1, "Court 1")).getId();
        courtTwo = courts.save(new Court(2, "Court 2")).getId();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    @Test
    void givenFourConfirmedOccurrences_whenCreating_thenFourBookingsShareOneSeries() {
        // given
        SeriesPreview preview = previewAsTrainer(rule(4));
        List<Instant> confirmed = starts(preview);

        // when
        SeriesCreationResult result = create(confirmed);

        // then
        assertThat(result.bookingIds()).hasSize(4);
        assertThat(result.skipped()).isEmpty();
        assertThat(bookings.findAllById(result.bookingIds()))
                .allSatisfy(booking ->
                        assertThat(booking.getSeriesId()).isEqualTo(result.seriesId()));
    }

    @Test
    void givenEachOccupiesTwoCourts_whenCreating_thenEachBookingHoldsTwoAllocations() {
        // given
        SeriesPreview preview = previewAsTrainer(rule(2));

        // when
        SeriesCreationResult result = create(starts(preview));

        // then
        Booking first = bookings.findWithAllocationsById(result.bookingIds().getFirst()).orElseThrow();
        assertThat(first.getAllocations()).hasSize(2);
    }

    @Test
    void givenACourtIsTakenAfterThePreview_whenCreating_thenThatDateIsSkippedAndTheRestIsCreated() {
        // given
        SeriesPreview preview = previewAsTrainer(rule(4));
        List<Instant> confirmed = starts(preview);

        bookingService.create(new CreateBookingCommand(
                List.of(courtTwo), TRAINING_CARD,
                new TimeSlot(confirmed.get(1), confirmed.get(1).plusSeconds(7200)),
                UUID.randomUUID(), null, Set.of(Role.TRAINER), null, List.of(), null));

        // when
        SeriesCreationResult result = create(confirmed);

        // then
        assertThat(result.bookingIds()).hasSize(3);
        assertThat(result.skipped()).containsExactly(confirmed.get(1));
    }

    @Test
    void givenAnEmptyConfirmationList_whenCreating_thenNoSeriesIsStored() {
        // when
        SeriesCreationResult result = create(List.of());

        // then
        assertThat(result.bookingIds()).isEmpty();
        assertThat(result.seriesId()).isNull();
        assertThat(bookings.findAll()).isEmpty();
        assertThat(seriesRepository.count()).isZero();
    }

    @Test
    void givenAMemberBeyondTheAdvanceWindow_whenCreatingEveryOccurrence_thenTheLaterOnesAreSkippedAsRuleViolations() {
        // given — the "Standard" rule set caps advance booking at 7 days
        UUID personId = persons.save(new Person("Mary", "Major", "mary@example.org")).getId();
        members.save(new Member(personId, STANDARD_MEMBERSHIP));
        SeriesRule rule = fridaysFromApril3(4);

        // when
        SeriesCreationResult result = seriesService.create(rule, allStarts(previewAsTrainer(rule)),
                UUID.randomUUID(), personId, Set.of(Role.TRAINER), "Team training");

        // then
        assertThat(result.seriesId()).isNotNull();
        assertThat(result.bookingIds()).hasSize(1);
        assertThat(result.skipped()).hasSize(3);
    }

    @Test
    void givenABookerBeyondTheAdvanceWindow_whenPreviewingAndCreating_thenThePreviewPromisesWhatCreateDelivers() {
        // given — the "Standard" rule set caps advance booking at 7 days
        UUID personId = persons.save(new Person("Mary", "Major", "mary@example.org")).getId();
        members.save(new Member(personId, STANDARD_MEMBERSHIP));
        UUID bookedBy = UUID.randomUUID();
        SeriesRule rule = fridaysFromApril3(6);

        // when
        SeriesPreview preview = seriesService.preview(rule, bookedBy, personId, Set.of(Role.TRAINER));
        SeriesCreationResult result = seriesService.create(rule, starts(preview), bookedBy, personId,
                Set.of(Role.TRAINER), "Team training");

        // then
        assertThat(preview.occurrences()).hasSize(6);
        assertThat(preview.creatableCount()).isEqualTo(1);
        assertThat(result.bookingIds()).hasSize((int) preview.creatableCount());
        assertThat(result.skipped()).isEmpty();
    }

    @Test
    void givenAnAdminBookerBeyondTheAdvanceWindow_whenPreviewingAndCreating_thenEveryOccurrenceIsOfferedAndCreated() {
        // given
        UUID personId = persons.save(new Person("John", "Roe", "john@example.org")).getId();
        members.save(new Member(personId, STANDARD_MEMBERSHIP));
        UUID bookedBy = UUID.randomUUID();
        SeriesRule rule = fridaysFromApril3(6);

        // when
        SeriesPreview preview = seriesService.preview(rule, bookedBy, personId, Set.of(Role.ADMIN));
        SeriesCreationResult result = seriesService.create(rule, starts(preview), bookedBy, personId,
                Set.of(Role.ADMIN), "Team training");

        // then
        assertThat(preview.creatableCount()).isEqualTo(6);
        assertThat(result.bookingIds()).hasSize(6);
        assertThat(result.skipped()).isEmpty();
    }

    @Test
    void givenACallerLacksTheRequiredCardRole_whenCreating_thenNoSeriesRowIsWritten() {
        // given
        List<Instant> confirmed = starts(previewAsTrainer(rule(4)));

        // when / then
        assertThatThrownBy(() -> seriesService.create(rule(4), confirmed, UUID.randomUUID(), null,
                Set.of(Role.MEMBER), "Team training"))
                .isInstanceOf(CardRoleRequiredException.class);
        assertThat(seriesRepository.count()).isZero();
    }

    @Test
    void givenACardThatTracksPlayers_whenCreating_thenItIsRejectedAndNoSeriesRowIsWritten() {
        // given
        List<Instant> confirmed = starts(previewAsTrainer(rule(4)));
        SeriesRule memberCardRule = new SeriesRule(
                List.of(courtOne, courtTwo), MEMBER_BOOKING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 4);

        // when / then
        assertThatThrownBy(() -> seriesService.create(memberCardRule, confirmed, UUID.randomUUID(), null,
                Set.of(Role.MEMBER), "Club round"))
                .isInstanceOfSatisfying(ParticipantsInvalidException.class, exception ->
                        assertThat(exception.getCode()).isEqualTo("booking.series.cardTracksPlayers"));
        assertThat(seriesRepository.count()).isZero();
    }

    @Test
    void givenACardThatDoesNotTrackPlayers_whenCreating_thenItStillSucceeds() {
        // given
        List<Instant> confirmed = starts(previewAsTrainer(rule(2)));

        // when
        SeriesCreationResult result = seriesService.create(rule(2), confirmed, UUID.randomUUID(), null,
                Set.of(Role.TRAINER), "Team training");

        // then
        assertThat(result.bookingIds()).hasSize(2);
        assertThat(result.skipped()).isEmpty();
    }

    @Test
    void givenEveryConfirmedOccurrenceRunsPastClosingTime_whenCreating_thenNothingIsCreatedAndNoSeriesRowSurvives() {
        // given
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(21, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 4);
        List<Instant> confirmed = previewAsTrainer(rule).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();

        // when
        SeriesCreationResult result = seriesService.create(rule, confirmed, UUID.randomUUID(), null,
                Set.of(Role.TRAINER), "Team training");

        // then
        assertThat(result.seriesId()).isNull();
        assertThat(result.bookingIds()).isEmpty();
        assertThat(result.skipped()).hasSize(4);
        assertThat(seriesRepository.count()).isZero();
    }

    @Test
    void givenEveryConfirmedOccurrenceIsInThePast_whenCreating_thenNothingIsCreatedAndNoSeriesRowSurvives() {
        // given
        SeriesRule rule = new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 3, 3), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, 2);
        List<Instant> confirmed = allStarts(previewAsTrainer(rule));

        // when
        SeriesCreationResult result = seriesService.create(rule, confirmed, UUID.randomUUID(), null,
                Set.of(Role.ADMIN), "Team training");

        // then
        assertThat(result.seriesId()).isNull();
        assertThat(result.bookingIds()).isEmpty();
        assertThat(result.skipped()).containsExactlyElementsOf(confirmed);
        assertThat(seriesRepository.count()).isZero();
    }

    @Test
    void givenTheSameConfirmedStartTwice_whenCreating_thenItIsRejectedAndNoSeriesRowIsWritten() {
        // given
        Instant first = starts(previewAsTrainer(rule(4))).getFirst();

        // when / then
        assertThatThrownBy(() -> create(List.of(first, first)))
                .isInstanceOf(SeriesRequestInvalidException.class)
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.type(
                        SeriesRequestInvalidException.class))
                .satisfies(failure -> assertThat(failure.getCode())
                        .isEqualTo("booking.series.duplicateStart"));
        assertThat(seriesRepository.count()).isZero();
    }

    @Test
    void givenAConfirmedStartTheScheduleNeverOffered_whenCreating_thenItIsRejected() {
        // given
        List<Instant> confirmed = new ArrayList<>(starts(previewAsTrainer(rule(4))));
        confirmed.set(0, confirmed.get(0).plus(1, ChronoUnit.DAYS));

        // when / then
        assertThatThrownBy(() -> create(confirmed))
                .isInstanceOf(SeriesRequestInvalidException.class)
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.type(
                        SeriesRequestInvalidException.class))
                .satisfies(failure -> assertThat(failure.getCode())
                        .isEqualTo("booking.series.startNotOffered"));
        assertThat(seriesRepository.count()).isZero();
    }

    private SeriesPreview previewAsTrainer(SeriesRule rule) {
        return seriesService.preview(rule, trainer, null, Set.of(Role.TRAINER));
    }

    private List<Instant> starts(SeriesPreview preview) {
        return preview.occurrences().stream()
                .filter(SeriesPreview.Occurrence::isCreatable)
                .map(occurrence -> occurrence.slot().start())
                .toList();
    }

    private List<Instant> allStarts(SeriesPreview preview) {
        return preview.occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
    }

    private SeriesRule fridaysFromApril3(int count) {
        return new SeriesRule(
                List.of(courtOne), TRAINING_CARD,
                LocalDate.of(2026, 4, 3), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.FRIDAY), null, count);
    }

    private SeriesCreationResult create(List<Instant> confirmed) {
        return seriesService.create(rule(4), confirmed, UUID.randomUUID(), null,
                Set.of(Role.TRAINER), "Team training");
    }

    private SeriesRule rule(int count) {
        return new SeriesRule(
                List.of(courtOne, courtTwo), TRAINING_CARD,
                LocalDate.of(2026, 4, 7), LocalTime.of(18, 0), 120,
                1, Set.of(DayOfWeek.TUESDAY), null, count);
    }
}
