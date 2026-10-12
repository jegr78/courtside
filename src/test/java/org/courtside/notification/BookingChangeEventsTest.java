package org.courtside.notification;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.booking.BookingRulesViolatedException;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.series.CancelScope;
import org.courtside.booking.series.MoveRequest;
import org.courtside.booking.series.SeriesCreationResult;
import org.courtside.booking.series.SeriesMoveConflictException;
import org.courtside.booking.series.SeriesRule;
import org.courtside.booking.series.SeriesService;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.BookingCancelled;
import org.courtside.shared.DomainEventRecord;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.SeriesCancelled;
import org.courtside.shared.SeriesCreated;
import org.courtside.shared.SeriesMoved;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doAnswer;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
@Import({FacilityTestFixture.class, IdentityTestFixture.class, ConfigTestFixture.class,
        RulesTestFixture.class, AuditTestFixture.class, BookingChangeEventsTest.OccupancyConsumer.class})
class BookingChangeEventsTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID STANDARD_RULE_SET =
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final TimeSlot WEDNESDAY_EVENING = new TimeSlot(
            Instant.parse("2026-04-08T16:00:00Z"), Instant.parse("2026-04-08T17:00:00Z"));
    private static final Duration DELIVERY = Duration.ofSeconds(10);

    @MockitoSpyBean
    private BookingService bookings;

    @Autowired
    private SeriesService series;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private ConfigTestFixture config;

    @Autowired
    private RulesTestFixture rules;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private OccupancyConsumer consumer;

    @Autowired
    private PlatformTransactionManager transactions;

    private UUID courtId;
    private UUID memberPerson;
    private UUID member;
    private final UUID trainer = UUID.randomUUID();

    @BeforeEach
    void aClubWithOneCourtAndOneMember() {
        consumer.forget();
        courtId = facility.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        memberPerson = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        member = identity.createEnabledAccount(memberPerson, "doe.jane", Set.of(Role.MEMBER));
    }

    @Test
    void givenAMemberBooking_whenTheMemberCancelsIt_thenOneCancellationReachesAnotherModuleAfterCommit() {
        // given
        UUID bookingId = memberBooking();

        // when
        bookings.cancel(bookingId, member, Set.of(Role.MEMBER));

        // then
        Delivery delivery = consumer.awaitOnly(BookingCancelled.class);
        assertThat(delivery.event()).isEqualTo(new BookingCancelled(bookingId, member));
        assertThat(delivery.seen().get(bookingId).cancelled())
                .as("the consumer reads the cancellation the event announced, so it ran after the commit")
                .isTrue();
        assertThat(audit.eventsOfType("booking.booking.cancelled")).extracting(RecordedEvent::payload)
                .containsExactly(Map.of("bookingId", bookingId.toString(),
                        "cancelledByAccountId", member.toString()));
    }

    @Test
    void givenAMemberBooking_whenABoardCancelsIt_thenTheEventNamesTheBoardAccountRatherThanTheOwner() {
        // given
        UUID bookingId = memberBooking();
        UUID board = identity.createEnabledAccount(
                identity.createPerson("Richard", "Miles"), "miles.richard", Set.of(Role.ADMIN));

        // when
        bookings.cancel(bookingId, board, Set.of(Role.ADMIN));

        // then
        assertThat(audit.eventsOfType("booking.booking.cancelled")).extracting(RecordedEvent::payload)
                .containsExactly(Map.of("bookingId", bookingId.toString(),
                        "cancelledByAccountId", board.toString()));
        assertThat(consumer.awaitOnly(BookingCancelled.class).event())
                .isEqualTo(new BookingCancelled(bookingId, board));
    }

    @Test
    void givenACancelledBooking_whenABoardCancelsItAgain_thenTheCallStillSucceedsAndOnlyTheFirstCancellationIsAnnounced() {
        // given
        UUID bookingId = memberBooking();
        UUID board = identity.createEnabledAccount(
                identity.createPerson("Richard", "Miles"), "miles.richard", Set.of(Role.ADMIN));
        bookings.cancel(bookingId, member, Set.of(Role.MEMBER));

        // when
        bookings.cancel(bookingId, board, Set.of(Role.ADMIN));

        // then
        assertThat(audit.eventsOfType("booking.booking.cancelled")).extracting(RecordedEvent::payload)
                .as("a repeated cancel changes nothing and must not announce a second canceller")
                .containsExactly(Map.of("bookingId", bookingId.toString(),
                        "cancelledByAccountId", member.toString()));
        assertThat(consumer.awaitOnly(BookingCancelled.class).event())
                .isEqualTo(new BookingCancelled(bookingId, member));
    }

    @Test
    void givenASeriesOccurrence_whenItIsCancelledAsASingleBooking_thenOneBookingCancellationAndNoSeriesEventIsAnnounced() {
        // given
        SeriesCreationResult created = createSeries(3);
        UUID occurrence = created.bookingIds().get(1);

        // when
        bookings.cancel(occurrence, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(audit.eventsOfType("booking.booking.cancelled")).extracting(RecordedEvent::payload)
                .containsExactly(Map.of("bookingId", occurrence.toString(),
                        "cancelledByAccountId", trainer.toString()));
        assertThat(audit.eventsOfType("booking.series.cancelled")).as("series events for a single cancel")
                .isEmpty();
        assertThat(consumer.awaitOnly(BookingCancelled.class).event())
                .isEqualTo(new BookingCancelled(occurrence, trainer));
    }

    @Test
    void givenACancellationWhoseTransactionRollsBack_whenItEnds_thenNothingIsAnnouncedOrRecorded() {
        // given
        UUID bookingId = memberBooking();

        // when
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            bookings.cancel(bookingId, member, Set.of(Role.MEMBER));
            status.setRollbackOnly();
        });

        // then
        assertThat(audit.eventsOfType("booking.booking.cancelled")).as("audit rows of a rolled-back cancel")
                .isEmpty();
        assertThat(consumer.deliveries()).as("deliveries of a rolled-back cancel").isEmpty();
    }

    @Test
    void givenThreeOfFourStartsAreFree_whenTheSeriesIsCreated_thenOneEventNamesExactlyTheCreatedOccurrences() {
        // given
        SeriesRule rule = trainingRule(4);
        List<Instant> starts = startsOf(rule);
        occupy(starts.get(1));

        // when
        SeriesCreationResult created = series.create(rule, starts, trainer, null, Set.of(Role.TRAINER),
                "Training");

        // then
        assertThat(created.bookingIds()).hasSize(3);
        Delivery delivery = consumer.awaitOnly(SeriesCreated.class);
        assertThat(delivery.event()).isEqualTo(new SeriesCreated(created.seriesId(), created.bookingIds()));
        assertThat(delivery.seen().values()).as("occurrences the consumer reads after the commit")
                .hasSize(3).noneMatch(BookingAnnouncement::cancelled);
        assertThat(audit.eventsOfType("booking.series.created")).extracting(RecordedEvent::payload)
                .containsExactly(Map.of("seriesId", created.seriesId().toString(),
                        "bookingIds", created.bookingIds().stream().map(UUID::toString).toList()));
        assertThat(created.bookingIds()).as("occurrences confirming themselves")
                .allSatisfy(bookingId -> assertThat(audit.eventsAbout(bookingId)).isEmpty());
    }

    @Test
    void givenEveryStartIsTaken_whenTheSeriesIsCreated_thenNoSeriesExistsAndNothingIsAnnounced() {
        // given
        SeriesRule rule = trainingRule(2);
        List<Instant> starts = startsOf(rule);
        starts.forEach(this::occupy);

        // when
        SeriesCreationResult created = series.create(rule, starts, trainer, null, Set.of(Role.TRAINER),
                "Training");

        // then
        assertThat(created.seriesId()).isNull();
        assertThat(audit.eventsOfType("booking.series.created")).as("audit rows of a series never created")
                .isEmpty();
        assertThat(consumer.deliveries()).as("deliveries of a series never created").isEmpty();
    }

    @Test
    void givenAMiddleOccurrenceFailsUnexpectedly_whenTheSeriesIsCreated_thenTheOccurrencesThatCommittedAreAnnounced() {
        // given
        SeriesRule rule = trainingRule(3);
        List<Instant> starts = startsOf(rule);
        AtomicInteger occurrencesWritten = new AtomicInteger();
        doAnswer(invocation -> {
            if (occurrencesWritten.incrementAndGet() == 2) {
                throw new IllegalStateException("simulated failure");
            }
            return invocation.callRealMethod();
        }).when(bookings).create(argThat((CreateBookingCommand command) -> command.seriesId() != null));

        // when / then
        assertThatThrownBy(() -> series.create(rule, starts, trainer, null, Set.of(Role.TRAINER), "Training"))
                .isInstanceOf(IllegalStateException.class).hasMessage("simulated failure");
        assertThat(audit.eventsOfType("booking.series.created"))
                .as("a series left with a committed occurrence is announced").hasSize(1);
        Delivery delivery = consumer.awaitOnly(SeriesCreated.class);
        SeriesCreated announced = (SeriesCreated) delivery.event();
        assertThat(announced.bookingIds()).as("occurrences committed before the failure").hasSize(1);
        assertThat(audit.eventsOfType("booking.series.created")).extracting(RecordedEvent::payload)
                .containsExactly(Map.of("seriesId", announced.seriesId().toString(),
                        "bookingIds", List.of(announced.bookingIds().getFirst().toString())));
        assertThat(delivery.seen().values()).as("committed occurrences the consumer reads")
                .hasSize(1).noneMatch(BookingAnnouncement::cancelled);
    }

    @Test
    void givenFiveOccurrences_whenCancellingThisAndFollowing_thenOneEventNamesTheTailAndWhoCancelled() {
        // given
        SeriesCreationResult created = createSeries(5);
        List<UUID> tail = created.bookingIds().subList(2, 5);

        // when
        series.cancel(created.seriesId(), created.bookingIds().get(2), CancelScope.THIS_AND_FOLLOWING,
                trainer, Set.of(Role.TRAINER));

        // then
        Delivery delivery = consumer.awaitOnly(SeriesCancelled.class);
        assertThat(delivery.event()).isEqualTo(new SeriesCancelled(created.seriesId(), tail, trainer));
        assertThat(delivery.seen().values()).as("occurrences the consumer reads after the commit")
                .hasSize(3).allMatch(BookingAnnouncement::cancelled);
        assertThat(audit.eventsOfType("booking.series.cancelled")).hasSize(1);
        assertThat(audit.eventsOfType("booking.booking.cancelled"))
                .as("a series cancellation is one change and announces no occurrence on its own")
                .isEmpty();
    }

    @Test
    void givenThreeOccurrences_whenCancellingOnlyOne_thenTheEventNamesThatOccurrenceAlone() {
        // given
        SeriesCreationResult created = createSeries(3);
        UUID only = created.bookingIds().get(1);

        // when
        series.cancel(created.seriesId(), only, CancelScope.THIS, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(audit.eventsOfType("booking.series.cancelled")).extracting(RecordedEvent::payload)
                .containsExactly(Map.of("seriesId", created.seriesId().toString(),
                        "bookingIds", List.of(only.toString()), "cancelledByAccountId", trainer.toString()));
        assertThat(consumer.awaitOnly(SeriesCancelled.class).event())
                .isEqualTo(new SeriesCancelled(created.seriesId(), List.of(only), trainer));
    }

    @Test
    void givenAnOccurrenceAlreadyCancelled_whenCancellingItAgain_thenNothingChangesAndNothingIsAnnounced() {
        // given
        SeriesCreationResult created = createSeries(2);
        UUID only = created.bookingIds().getFirst();
        series.cancel(created.seriesId(), only, CancelScope.THIS, trainer, Set.of(Role.TRAINER));
        consumer.awaitOnly(SeriesCancelled.class);
        consumer.forget();

        // when
        int cancelled = series.cancel(created.seriesId(), only, CancelScope.THIS, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(cancelled).isZero();
        assertThat(audit.eventsOfType("booking.series.cancelled")).as("audit rows after cancelling nothing")
                .hasSize(1);
    }

    @Test
    void givenAnOccurrenceAlreadyCancelled_whenMovingOnlyIt_thenNothingMovesAndNothingIsAnnounced() {
        // given
        SeriesCreationResult created = createSeries(2);
        UUID only = created.bookingIds().getFirst();
        series.cancel(created.seriesId(), only, CancelScope.THIS, trainer, Set.of(Role.TRAINER));
        consumer.awaitOnly(SeriesCancelled.class);
        consumer.forget();

        // when
        int moved = series.move(new MoveRequest(created.seriesId(), only, CancelScope.THIS,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        assertThat(moved).isZero();
        assertThat(audit.eventsOfType("booking.series.moved")).as("audit rows after moving nothing").isEmpty();
    }

    @Test
    void givenOneOccurrenceIsPastTheDeadline_whenCancellingTheWholeSeries_thenNothingIsAnnouncedOrRecorded() {
        // given
        config.bindPeopleWithoutAMembershipTypeTo(STANDARD_RULE_SET);
        rules.setCancellationDeadline(STANDARD_RULE_SET, 10080);
        SeriesCreationResult created = createSeries(3);
        consumer.forget();

        // when / then
        assertThatThrownBy(() -> series.cancel(created.seriesId(), created.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(BookingRulesViolatedException.class);
        assertThat(audit.eventsOfType("booking.series.cancelled")).as("audit rows of a refused cancellation")
                .isEmpty();
        assertThat(consumer.deliveries()).as("deliveries of a refused cancellation").isEmpty();
    }

    @Test
    void givenFourOccurrences_whenMovingThisAndFollowing_thenOneEventNamesTheMovedOccurrencesAndWhoMovedThem() {
        // given
        SeriesCreationResult created = createSeries(4);
        List<UUID> moved = created.bookingIds().subList(1, 4);
        consumer.forget();

        // when
        series.move(new MoveRequest(created.seriesId(), moved.getFirst(), CancelScope.THIS_AND_FOLLOWING,
                LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER));

        // then
        Delivery delivery = consumer.awaitOnly(SeriesMoved.class);
        assertThat(delivery.event()).isEqualTo(new SeriesMoved(created.seriesId(), moved, trainer));
        assertThat(delivery.seen().values()).as("start times the consumer reads after the commit")
                .extracting(BookingAnnouncement::startsAt)
                .containsExactly(Instant.parse("2026-04-14T18:00:00Z"), Instant.parse("2026-04-21T18:00:00Z"),
                        Instant.parse("2026-04-28T18:00:00Z"));
        assertThat(audit.eventsOfType("booking.series.moved")).extracting(RecordedEvent::payload)
                .containsExactly(Map.of("seriesId", created.seriesId().toString(),
                        "bookingIds", moved.stream().map(UUID::toString).toList(),
                        "movedByAccountId", trainer.toString()));
    }

    @Test
    void givenTheTargetSlotIsTaken_whenMovingTheSeries_thenNothingIsAnnouncedOrRecorded() {
        // given
        SeriesCreationResult created = createSeries(2);
        occupy(Instant.parse("2026-04-14T18:00:00Z"));
        consumer.forget();

        // when / then
        assertThatThrownBy(() -> series.move(new MoveRequest(created.seriesId(), created.bookingIds().getFirst(),
                CancelScope.WHOLE_SERIES, LocalTime.of(20, 0), null, null), trainer, Set.of(Role.TRAINER)))
                .isInstanceOf(SeriesMoveConflictException.class);
        assertThat(audit.eventsOfType("booking.series.moved")).as("audit rows of a refused move").isEmpty();
        assertThat(consumer.deliveries()).as("deliveries of a refused move").isEmpty();
    }

    private UUID memberBooking() {
        UUID bookingId = bookings.create(new CreateBookingCommand(List.of(courtId), MEMBER_BOOKING_CARD,
                WEDNESDAY_EVENING, member, memberPerson, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("John Roe")), null));
        consumer.forget();
        return bookingId;
    }

    private SeriesCreationResult createSeries(int count) {
        SeriesRule rule = trainingRule(count);
        SeriesCreationResult created = series.create(rule, startsOf(rule), trainer, null, Set.of(Role.TRAINER),
                "Training");
        consumer.awaitOnly(SeriesCreated.class);
        consumer.forget();
        return created;
    }

    private SeriesRule trainingRule(int count) {
        return new SeriesRule(List.of(courtId), TRAINING_CARD, LocalDate.of(2026, 4, 7),
                LocalTime.of(18, 0), 120, 1, Set.of(DayOfWeek.TUESDAY), null, count);
    }

    private List<Instant> startsOf(SeriesRule rule) {
        return series.preview(rule, trainer, null, Set.of(Role.TRAINER)).occurrences().stream()
                .map(occurrence -> occurrence.slot().start())
                .toList();
    }

    private void occupy(Instant start) {
        bookings.create(new CreateBookingCommand(List.of(courtId), TRAINING_CARD,
                new TimeSlot(start, start.plus(Duration.ofHours(2))), trainer, null, Set.of(Role.TRAINER),
                null, List.of(), null));
    }

    record Delivery(DomainEventRecord event, Map<UUID, BookingAnnouncement> seen) {
    }

    static class OccupancyConsumer {

        private final BookingAnnouncer announcer;
        private final List<Delivery> deliveries = new CopyOnWriteArrayList<>();

        OccupancyConsumer(BookingAnnouncer announcer) {
            this.announcer = announcer;
        }

        @ApplicationModuleListener
        void on(BookingCancelled event) {
            receive(event, List.of(event.bookingId()));
        }

        @ApplicationModuleListener
        void on(SeriesCreated event) {
            receive(event, event.bookingIds());
        }

        @ApplicationModuleListener
        void on(SeriesCancelled event) {
            receive(event, event.bookingIds());
        }

        @ApplicationModuleListener
        void on(SeriesMoved event) {
            receive(event, event.bookingIds());
        }

        List<Delivery> deliveries() {
            return List.copyOf(deliveries);
        }

        void forget() {
            deliveries.clear();
        }

        Delivery awaitOnly(Class<? extends DomainEventRecord> type) {
            await().atMost(DELIVERY).untilAsserted(() -> assertThat(deliveries)
                    .as("a delivery of %s after the commit", type.getSimpleName()).isNotEmpty());
            assertThat(deliveries).as("deliveries after one committed change").hasSize(1)
                    .allMatch(delivery -> type.isInstance(delivery.event()));
            return deliveries.getFirst();
        }

        private void receive(DomainEventRecord event, List<UUID> bookingIds) {
            Map<UUID, BookingAnnouncement> seen = new LinkedHashMap<>();
            bookingIds.forEach(bookingId -> announcer.describe(bookingId)
                    .ifPresent(announcement -> seen.put(bookingId, announcement)));
            deliveries.add(new Delivery(event, seen));
        }
    }
}
