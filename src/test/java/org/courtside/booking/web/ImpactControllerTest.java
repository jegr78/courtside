package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.booking.internal.ImpactService;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class ImpactControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private BookingService bookings;

    @Autowired
    private ImpactService impact;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenFutureBookingsOnACourt_whenAskingWhatDeactivatingItWouldAffect_thenOnlyItsOwnAreListed()
            throws Exception {
        // given
        UUID courtOne = courts.save(new Court(1, null)).getId();
        UUID courtTwo = courts.save(new Court(2, null)).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        book(courtOne, bookerPersonId, "2026-05-12T16:00:00Z", "2026-05-12T17:00:00Z");
        book(courtOne, bookerPersonId, "2026-05-19T16:00:00Z", "2026-05-19T17:00:00Z");
        book(courtTwo, bookerPersonId, "2026-05-12T16:00:00Z", "2026-05-12T17:00:00Z");

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + courtOne))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(2))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.bookings.length()").value(2));
    }

    @Test
    void givenACourtWithNoFutureBookings_whenAskingWhatDeactivatingItWouldAffect_thenAffectedCountIsZeroAndTheListIsEmpty()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + court))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(0))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.bookings.length()").value(0));
    }

    @Test
    void givenACancelledBooking_whenAskingWhatDeactivatingTheCourtWouldAffect_thenItIsNotCounted()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        setStandardOpeningHours();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        UUID confirmedBookingId = book(court, bookerPersonId, "2026-05-12T16:00:00Z", "2026-05-12T17:00:00Z");
        insertBooking(court, "2026-05-12T18:00:00Z", "2026-05-12T19:00:00Z", "CANCELLED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + court))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(confirmedBookingId.toString()));
    }

    @Test
    void givenABookingThatHasAlreadyStarted_whenAskingWhatDeactivatingTheCourtWouldAffect_thenItIsNotCounted()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        setStandardOpeningHours();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        UUID futureBookingId = book(court, bookerPersonId, "2026-05-12T16:00:00Z", "2026-05-12T17:00:00Z");
        insertBooking(court, "2026-05-12T08:00:00Z", "2026-05-12T09:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + court))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(futureBookingId.toString()));
    }

    @Test
    void givenBookingsOnTwoCards_whenAskingWhatRetiringOneCardWouldAffect_thenOnlyItsOwnAreListed()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        setStandardOpeningHours();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        book(court, bookerPersonId, "2026-05-12T16:00:00Z", "2026-05-12T17:00:00Z");
        UUID trainingBookingId = insertBookingWithCard(
                TRAINING_CARD, court, "2026-05-12T18:00:00Z", "2026-05-12T19:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/booking-cards/" + TRAINING_CARD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(trainingBookingId.toString()));
    }

    @Test
    void givenABookingOnTwoCourts_whenAskingWhatRetiringItsCardWouldAffect_thenItIsCountedOnce()
            throws Exception {
        // given
        UUID courtOne = courts.save(new Court(1, null)).getId();
        UUID courtTwo = courts.save(new Court(2, null)).getId();
        setStandardOpeningHours();
        UUID bookingId = bookings.create(new CreateBookingCommand(
                List.of(courtOne, courtTwo), TRAINING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T16:00:00Z"), Instant.parse("2026-05-12T17:00:00Z")),
                UUID.randomUUID(), null, Set.of(Role.TRAINER), null, List.of(), null));

        // when / then
        mockMvc.perform(get("/api/admin/impact/booking-cards/" + TRAINING_CARD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings.length()").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(bookingId.toString()))
                .andExpect(jsonPath("$.bookings[0].courtIds.length()").value(2))
                .andExpect(jsonPath("$.bookings[0].courtIds",
                        containsInAnyOrder(courtOne.toString(), courtTwo.toString())));
    }

    @Test
    void givenBookingsInsideAndOutsideTheProposedHours_whenNarrowingTuesday_thenOnlyTheOutOfHoursBookingIsListed()
            throws Exception {
        // given — 2026-05-12 is a Tuesday; Europe/Berlin runs CEST (+2) then
        UUID court = courts.save(new Court(1, null)).getId();
        setStandardOpeningHours();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        book(court, bookerPersonId, "2026-05-12T13:00:00Z", "2026-05-12T14:00:00Z");
        UUID lateBookingId = book(court, bookerPersonId, "2026-05-12T19:00:00Z", "2026-05-12T20:00:00Z");

        // when / then
        mockMvc.perform(get("/api/admin/impact/opening-hours/TUESDAY")
                        .param("opensAt", "08:00")
                        .param("closesAt", "18:00"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(lateBookingId.toString()));
    }

    @Test
    void givenTuesdayBookings_whenClosingTuesdayEntirely_thenEveryTuesdayBookingIsListed() throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        setStandardOpeningHours();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();

        book(court, bookerPersonId, "2026-05-12T13:00:00Z", "2026-05-12T14:00:00Z");
        book(court, bookerPersonId, "2026-05-12T19:00:00Z", "2026-05-12T20:00:00Z");

        // when / then
        mockMvc.perform(get("/api/admin/impact/opening-hours/TUESDAY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(2))
                .andExpect(jsonPath("$.bookings.length()").value(2));
    }

    @Test
    void givenAnUnknownCourt_whenAskingWhatDeactivatingItWouldAffect_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title").value("Court not found"));
    }

    @Test
    void given51FutureBookingsOnACourt_whenRequestingBothPages_thenEveryBookingCanBeRead()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        Instant start = Instant.parse("2026-05-13T08:00:00Z");
        UUID firstPageCursor = null;
        UUID lastBookingId = null;
        for (int i = 0; i < 51; i++) {
            Instant slotStart = start.plusSeconds(i * 1800L);
            Instant slotEnd = slotStart.plusSeconds(1800L);
            lastBookingId = insertBooking(court, slotStart.toString(), slotEnd.toString(), "CONFIRMED");
            if (i == 49) {
                firstPageCursor = lastBookingId;
            }
        }

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + court))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(51))
                .andExpect(jsonPath("$.truncated").value(true))
                .andExpect(jsonPath("$.nextCursor").value(firstPageCursor.toString()))
                .andExpect(jsonPath("$.bookings.length()").value(50));
        mockMvc.perform(get("/api/admin/impact/courts/" + court)
                        .param("cursor", firstPageCursor.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(51))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.bookings.length()").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(lastBookingId.toString()));
    }

    @Test
    void givenExactly50FutureBookingsOnACourt_whenAskingWhatDeactivatingItWouldAffect_thenTheFullListIsReturnedUntruncated()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        Instant start = Instant.parse("2026-05-13T08:00:00Z");
        for (int i = 0; i < 50; i++) {
            Instant slotStart = start.plusSeconds(i * 1800L);
            Instant slotEnd = slotStart.plusSeconds(1800L);
            insertBooking(court, slotStart.toString(), slotEnd.toString(), "CONFIRMED");
        }

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + court))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(50))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.bookings.length()").value(50));
    }

    @Test
    void givenAnImpactRequest_whenTheLimitExceedsTheMaximum_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + UUID.randomUUID()).param("limit", "101"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void givenAnInvalidLimit_whenCallingTheImpactService_thenItRejectsTheProgrammingError() {
        // when / then
        assertThatThrownBy(() -> impact.ofDeactivating(UUID.randomUUID(), null, 101))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Impact page size must be between 1 and 100");
    }

    @Test
    void givenTwoBookingsOnACard_whenRequestingTheSecondPage_thenTheRemainingBookingIsReturned()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        UUID firstBookingId = insertBookingWithCard(TRAINING_CARD, court,
                "2026-05-12T12:00:00Z", "2026-05-12T13:00:00Z", "CONFIRMED");
        UUID secondBookingId = insertBookingWithCard(TRAINING_CARD, court,
                "2026-05-12T14:00:00Z", "2026-05-12T15:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/booking-cards/" + TRAINING_CARD)
                        .param("cursor", firstBookingId.toString()).param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(2))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(secondBookingId.toString()));
    }

    @Test
    void givenTwoTuesdayBookings_whenRequestingTheSecondClosingImpactPage_thenTheRemainingBookingIsReturned()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        UUID firstBookingId = insertBooking(
                court, "2026-05-12T12:00:00Z", "2026-05-12T13:00:00Z", "CONFIRMED");
        UUID secondBookingId = insertBooking(
                court, "2026-05-12T14:00:00Z", "2026-05-12T15:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/opening-hours/TUESDAY")
                        .param("cursor", firstBookingId.toString()).param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(2))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(secondBookingId.toString()));
    }

    @Test
    void givenACursorFromAnotherCourt_whenRequestingImpact_thenNoPositionedBookingsAreDisclosed()
            throws Exception {
        // given
        UUID requestedCourt = courts.save(new Court(1, null)).getId();
        UUID otherCourt = courts.save(new Court(2, null)).getId();
        insertBooking(requestedCourt, "2026-05-12T12:00:00Z", "2026-05-12T13:00:00Z", "CONFIRMED");
        UUID foreignCursor = insertBooking(
                otherCourt, "2026-05-12T14:00:00Z", "2026-05-12T15:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + requestedCourt)
                        .param("cursor", foreignCursor.toString()).param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.bookings.length()").value(0));
    }

    @Test
    void givenABookingStartingAtExactlyTheCurrentInstant_whenAskingWhatDeactivatingTheCourtWouldAffect_thenItIsCounted()
            throws Exception {
        // given — the fixed clock reads 2026-05-12T10:00:00Z; a booking beginning this instant
        // has not started yet and must still be reported
        UUID court = courts.save(new Court(1, null)).getId();
        UUID bookingId = insertBooking(
                court, "2026-05-12T10:00:00Z", "2026-05-12T11:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/courts/" + court))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(bookingId.toString()));
    }

    @Test
    void givenABookingStartingAtExactlyTheCurrentInstant_whenAskingWhatRetiringItsCardWouldAffect_thenItIsCounted()
            throws Exception {
        // given
        UUID court = courts.save(new Court(1, null)).getId();
        UUID bookingId = insertBooking(
                court, "2026-05-12T10:00:00Z", "2026-05-12T11:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/booking-cards/" + MEMBER_BOOKING_CARD))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(bookingId.toString()));
    }

    @Test
    void givenABookingStartingAtExactlyTheCurrentInstant_whenAskingWhatClosingItsWeekdayWouldAffect_thenItIsCounted()
            throws Exception {
        // given — 10:00Z is 12:00 on a Tuesday in the club zone, so closing Tuesday strands it
        UUID court = courts.save(new Court(1, null)).getId();
        UUID bookingId = insertBooking(
                court, "2026-05-12T10:00:00Z", "2026-05-12T11:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/impact/opening-hours/TUESDAY"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affectedCount").value(1))
                .andExpect(jsonPath("$.bookings[0].bookingId").value(bookingId.toString()));
    }

    @Test
    void givenOpensAtWithoutClosesAt_whenAskingWhatNarrowingOpeningHoursWouldAffect_thenTheRequestIsRejected()
            throws Exception {
        // given — a future Tuesday booking exists so the request would otherwise have to be
        // evaluated against the incomplete pair, not merely accepted because there is nothing to check
        UUID court = courts.save(new Court(1, null)).getId();
        setStandardOpeningHours();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();
        book(court, bookerPersonId, "2026-05-12T13:00:00Z", "2026-05-12T14:00:00Z");

        // when / then
        mockMvc.perform(get("/api/admin/impact/opening-hours/TUESDAY")
                        .param("opensAt", "08:00"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:invalid-opening-window"))
                .andExpect(jsonPath("$.violations[0].code").value("openingWindow.incomplete"));
    }

    @Test
    void givenClosesAtWithoutOpensAt_whenAskingWhatNarrowingOpeningHoursWouldAffect_thenTheRequestIsRejected()
            throws Exception {
        // given — a future Tuesday booking exists so the request would otherwise have to be
        // evaluated against the incomplete pair, not merely accepted because there is nothing to check
        UUID court = courts.save(new Court(1, null)).getId();
        setStandardOpeningHours();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();
        book(court, bookerPersonId, "2026-05-12T13:00:00Z", "2026-05-12T14:00:00Z");

        // when / then
        mockMvc.perform(get("/api/admin/impact/opening-hours/TUESDAY")
                        .param("closesAt", "18:00"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:invalid-opening-window"))
                .andExpect(jsonPath("$.violations[0].code").value("openingWindow.incomplete"));
    }

    private void setStandardOpeningHours() {
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
    }

    private UUID book(UUID courtId, UUID bookerPersonId, String startsAt, String endsAt) {
        return bookings.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse(startsAt), Instant.parse(endsAt)),
                UUID.randomUUID(), bookerPersonId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Partner")), null));
    }

    private UUID insertBooking(UUID courtId, String startsAt, String endsAt, String status) {
        return insertBookingWithCard(MEMBER_BOOKING_CARD, courtId, startsAt, endsAt, status);
    }

    private UUID insertBookingWithCard(UUID cardId, UUID courtId,
                                       String startsAt, String endsAt, String status) {
        UUID bookingId = UUID.randomUUID();
        jdbc.sql("INSERT INTO booking (id, card_id, status) VALUES (?, ?, ?)")
                .params(bookingId, cardId, status)
                .update();
        jdbc.sql("""
                        INSERT INTO court_allocation
                            (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """)
                .params(UUID.randomUUID(), bookingId, courtId,
                        Instant.parse(startsAt).atOffset(ZoneOffset.UTC),
                        Instant.parse(endsAt).atOffset(ZoneOffset.UTC), status)
                .update();
        return bookingId;
    }
}
