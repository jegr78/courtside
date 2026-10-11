package org.courtside.booking.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.SqlStatementCounter;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.ParticipationService;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.BookingAnnouncement;
import org.courtside.shared.BookingAnnouncer;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class BookingAnnouncementsTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant SIX_PM = Instant.parse("2026-05-12T16:00:00Z");

    @Autowired
    private BookingAnnouncer announcer;

    @Autowired
    private BookingService bookings;

    @Autowired
    private ParticipationService participations;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private SqlStatementCounter queries;

    private List<UUID> courtIds;
    private UUID bookerPersonId;
    private UUID bookerAccountId;
    private UUID playerPersonId;
    private UUID playerAccountId;

    @BeforeEach
    void aBookerAndAPlayer() {
        courtIds = List.of(facility.createCourt(1, "Court 1"), facility.createCourt(2, "Court 2"),
                facility.createCourt(3, "Court 3"));
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        bookerPersonId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        bookerAccountId = identity.createEnabledAccount(bookerPersonId, "doe.jane", Set.of(Role.MEMBER));
        playerPersonId = identity.createPerson("John", "Roe", "john.roe@example.org");
        playerAccountId = identity.createEnabledAccount(playerPersonId, "roe.john", Set.of(Role.MEMBER));
    }

    @AfterEach
    void stopCounting() {
        queries.pause();
    }

    @Test
    void givenSeveralBookings_whenTheirOwnerHasThemDescribedTogether_thenEachMatchesItsSingleDescription() {
        // given
        List<UUID> booked = List.of(book(0, 0, ParticipantSpec.member(playerPersonId)),
                book(1, 1, ParticipantSpec.guest("Richard Miles")),
                book(2, 2, ParticipantSpec.member(playerPersonId)));

        // when
        Map<UUID, BookingAnnouncement> described =
                announcer.describeVisibleTo(bookerAccountId, bookerPersonId, booked);

        // then
        assertThat(described).as("the owner sees every booking they made").containsOnlyKeys(booked);
        booked.forEach(bookingId -> assertThat(described.get(bookingId))
                .as("the batch describes booking %s as a single read does", bookingId)
                .isEqualTo(announcer.describe(bookingId).orElseThrow()));
    }

    @Test
    void givenAPlayerWhoLeftOneOfTwoBookings_whenTheyHaveBothDescribed_thenOnlyTheOneTheyStillPlayInIsDescribed() {
        // given
        UUID stillIn = book(0, 0, ParticipantSpec.member(playerPersonId));
        UUID left = book(1, 1, ParticipantSpec.member(playerPersonId));
        UUID never = book(2, 2, ParticipantSpec.guest("Richard Miles"));
        participations.withdraw(left, playerPersonId, playerAccountId);

        // when
        Map<UUID, BookingAnnouncement> described =
                announcer.describeVisibleTo(playerAccountId, playerPersonId, List.of(stillIn, left, never));

        // then
        assertThat(described)
                .as("a booking is described only to its owner or a current player")
                .containsOnlyKeys(stillIn);
    }

    @Test
    void givenOneAndThenThreeBookings_whenDescribedTogether_thenTheStatementCountDoesNotGrow() {
        // given
        List<UUID> booked = List.of(book(0, 0, ParticipantSpec.member(playerPersonId)),
                book(1, 1, ParticipantSpec.member(playerPersonId)),
                book(2, 2, ParticipantSpec.member(playerPersonId)));
        queries.reset();
        announcer.describeVisibleTo(bookerAccountId, bookerPersonId, booked.subList(0, 1));
        long single = queries.snapshot().total();

        // when
        queries.reset();
        announcer.describeVisibleTo(bookerAccountId, bookerPersonId, booked);
        var batch = queries.snapshot();
        queries.pause();

        // then
        assertThat(batch.total()).as("three bookings cost what one costs: " + batch).isEqualTo(single);
    }

    @Test
    void whenNoBookingIsAsked_thenNothingIsReadAndNothingDescribed() {
        // given
        queries.reset();

        // when
        Map<UUID, BookingAnnouncement> described =
                announcer.describeVisibleTo(bookerAccountId, bookerPersonId, List.of());
        var snapshot = queries.snapshot();
        queries.pause();

        // then
        assertThat(described).isEmpty();
        assertThat(snapshot.total()).as("an empty page reads nothing: " + snapshot).isZero();
    }

    private UUID book(int court, int hour, ParticipantSpec player) {
        Instant from = SIX_PM.plusSeconds(3_600L * hour);
        return bookings.create(new CreateBookingCommand(List.of(courtIds.get(court)), MEMBER_BOOKING_CARD,
                new TimeSlot(from, from.plusSeconds(3_600)), bookerAccountId, bookerPersonId,
                Set.of(Role.MEMBER), null, List.of(player), null));
    }
}
