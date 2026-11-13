package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.internal.OccupancyKeys;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class HeldOpenDoorSignalTest extends AbstractIntegrationTest {

    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final long EXPIRES = NOW.plus(2, ChronoUnit.MINUTES).getEpochSecond();

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private OccupancyKeys keys;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private String key;
    private UUID courtOne;
    private UUID courtTwo;
    private UUID gateOne;
    private UUID gateTwo;
    private UUID trainer;
    private UUID campCard;

    @BeforeEach
    void twoGatedCourtsAndAKey() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtOne = facility.createCourt(1, "Centre Court");
        courtTwo = facility.createCourt(2, "Court 2");
        gateOne = facility.createAccessPoint("North gate", List.of(courtOne), null);
        gateTwo = facility.createAccessPoint("South gate", List.of(courtTwo), null);
        trainer = identity.createEnabledAccount(identity.createPerson("John", "Roe", "john@example.org"), "roe.john",
                Set.of(Role.TRAINER));
        campCard = cards.createBookingCard("Holiday camp", Set.of(Role.TRAINER), Set.of(Role.TRAINER));
        cards.letBookingsHoldDoorsOpen(campCard, true);
        key = keys.issue().key();
    }

    @Test
    void givenAHoldOnTheFirstCourt_whenPolled_thenOnlyItsGateReadsOpenAndEveryGateNamesTheExpiry() throws Exception {
        // given
        UUID booking = runningTraining(courtOne);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(10, ChronoUnit.MINUTES));

        // when
        String cacheControl = mockMvc.perform(get("/api/public/occupancy?key=" + key)).andReturn().getResponse()
                .getHeader("Cache-Control");
        List<String> lines = lines();

        // then
        assertThat(cacheControl).as("an open door must never come from a cache").isEqualTo("no-store");
        assertThat(lines).as("the held gate is open, the other closed, both valid for two minutes")
                .contains("door." + gateOne + ".open=1", "door." + gateOne + ".expires=" + EXPIRES,
                        "door." + gateTwo + ".open=0", "door." + gateTwo + ".expires=" + EXPIRES);
        assertThat(String.join("\n", lines)).as("no name, booking or person leaves the instance")
                .doesNotContain("North gate").doesNotContain(booking.toString()).doesNotContain("roe.john")
                .doesNotContain("Holiday camp");
    }

    @Test
    void givenAMembersDoorAndAHoldOnAnyCourt_whenPolled_thenTheMembersDoorReadsOpen() throws Exception {
        // given
        UUID clubhouse = facility.createAccessPoint("Clubhouse", List.of(), "135790", true);
        UUID booking = runningTraining(courtTwo);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(10, ChronoUnit.MINUTES));

        // when / then
        assertThat(lines()).as("a door every member may open stays open with any running hold")
                .contains("door." + clubhouse + ".open=1", "door." + gateTwo + ".open=1", "door." + gateOne + ".open=0");
    }

    @Test
    void givenAHoldThatEndedOrWasNeverStarted_whenPolled_thenEveryGateReadsClosed() throws Exception {
        // given
        UUID ended = runningTraining(courtOne);
        bookings.holdDoorsOpenAt(ended, trainer, NOW.minus(10, ChronoUnit.MINUTES));
        jdbc.sql("UPDATE door_hold SET ended_at = :at, ended_by = held_by WHERE booking_id = :id")
                .param("at", java.sql.Timestamp.from(NOW.minus(1, ChronoUnit.MINUTES))).param("id", ended).update();
        runningTraining(courtTwo);
        UUID clubhouse = facility.createAccessPoint("Clubhouse", List.of(), "135790", true);
        UUID shed = facility.createAccessPoint("Shed", List.of(), null);

        // when / then
        assertThat(lines()).as("without a running hold no door reads open, the members' door included")
                .contains("door." + gateOne + ".open=0", "door." + gateTwo + ".open=0",
                        "door." + clubhouse + ".open=0", "door." + shed + ".open=0");
    }

    @Test
    void givenAHoldNobodyEndedOnABookingThatIsOver_whenPolled_thenItsGateReadsClosed() throws Exception {
        // given
        UUID over = bookings.insertBookingThatHasStarted(courtOne, campCard,
                new TimeSlot(NOW.minus(90, ChronoUnit.MINUTES), NOW.minus(30, ChronoUnit.MINUTES)), trainer);
        bookings.holdDoorsOpenAt(over, trainer, NOW.minus(80, ChronoUnit.MINUTES));

        // when / then
        assertThat(lines()).as("a hold ends with its booking at the latest").contains("door." + gateOne + ".open=0");
    }

    @Test
    void givenABookingEndingNowWithAnUnendedHold_whenPolled_thenItsGateReadsClosed() throws Exception {
        // given
        UUID ending = bookings.insertBookingThatHasStarted(courtOne, campCard,
                new TimeSlot(NOW.minus(60, ChronoUnit.MINUTES), NOW), trainer);
        bookings.holdDoorsOpenAt(ending, trainer, NOW.minus(50, ChronoUnit.MINUTES));

        // when / then
        assertThat(lines()).as("the end itself already reads closed").contains("door." + gateOne + ".open=0");
    }

    @Test
    void givenAHoldBegunBeforeTheBookingsWindow_whenPolled_thenItsGateReadsClosed() throws Exception {
        // given
        UUID booking = runningTraining(courtOne);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(2, ChronoUnit.HOURS));

        // when / then
        assertThat(lines()).as("a hold from before a move holds the new window open nowhere")
                .contains("door." + gateOne + ".open=0");
    }

    @Test
    void givenACourtlessGateAndAHoldElsewhere_whenPolled_thenTheCourtlessGateReadsClosed() throws Exception {
        // given
        UUID shed = facility.createAccessPoint("Shed", List.of(), null);
        UUID booking = runningTraining(courtOne);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(10, ChronoUnit.MINUTES));

        // when / then
        assertThat(lines()).contains("door." + gateOne + ".open=1", "door." + shed + ".open=0");
    }

    @Test
    void givenAHoldOnACancelledBooking_whenPolled_thenItsGateReadsClosed() throws Exception {
        // given
        UUID cancelled = runningTraining(courtOne);
        bookings.holdDoorsOpenAt(cancelled, trainer, NOW.minus(10, ChronoUnit.MINUTES));
        bookings.cancelRecorded(cancelled);

        // when / then
        assertThat(lines()).contains("door." + gateOne + ".open=0");
    }

    @Test
    void givenACardThatStoppedHoldingDoors_whenPolled_thenTheRunningHoldNoLongerOpensTheGate() throws Exception {
        // given
        UUID booking = runningTraining(courtOne);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(10, ChronoUnit.MINUTES));
        cards.letBookingsHoldDoorsOpen(campCard, false);

        // when / then
        assertThat(lines()).as("switching the card off closes the doors at once").contains("door." + gateOne + ".open=0");
    }

    @Test
    void givenAnInactiveGate_whenPolled_thenItIsNotAnswered() throws Exception {
        // given
        facility.deactivateAccessPoint(gateTwo);

        // when / then
        assertThat(lines()).noneMatch(line -> line.startsWith("door." + gateTwo));
    }

    private UUID runningTraining(UUID court) {
        return bookings.insertBookingThatHasStarted(court, campCard,
                new TimeSlot(NOW.minus(30, ChronoUnit.MINUTES), NOW.plus(30, ChronoUnit.MINUTES)), trainer);
    }

    private List<String> lines() throws Exception {
        return mockMvc.perform(get("/api/public/occupancy?key=" + key)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString().lines().toList();
    }
}
