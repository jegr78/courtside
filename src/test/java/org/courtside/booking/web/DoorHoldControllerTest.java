package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.SeriesMoved;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DoorHoldControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private CardTestFixture cards;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private TransactionTemplate transactions;

    private MockMvc mockMvc;
    private UUID court;
    private UUID trainer;
    private UUID campCard;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        court = facility.createCourt(1, "Court 1");
        trainer = identity.createEnabledAccount(identity.createPerson("John", "Roe", "john@example.org"), "roe.john",
                Set.of(Role.TRAINER));
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles", "richard@example.org"),
                "miles.richard", Set.of(Role.TRAINER));
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane@example.org"), "doe.jane",
                Set.of(Role.MEMBER));
        identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary@example.org"), "major.mary",
                Set.of(Role.ADMIN));
        campCard = cards.createBookingCard("Holiday camp", Set.of(Role.TRAINER), Set.of(Role.TRAINER));
        cards.letBookingsHoldDoorsOpen(campCard, true);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenATrainingStartingSoon_whenItsTrainerHoldsTheDoorsOpen_thenTheBookingShowsTheRunningHold() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);

        // when
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.heldSince").value("2026-05-12T10:00:00Z"))
                .andExpect(jsonPath("$.heldByMe").value(true))
                .andExpect(jsonPath("$.opensAt").value("2026-05-12T09:50:00Z"))
                .andExpect(jsonPath("$.closesAt").value("2026-05-12T11:05:00Z"));

        // then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].id").value(booking.toString()))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").value("2026-05-12T10:00:00Z"))
                .andExpect(jsonPath("$.items[0].doorHold.heldByMe").value(true));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAMemberBooking_whenItsBookerHoldsTheDoorsOpen_thenTheConflictSaysTheCardOffersNoHold() throws Exception {
        // given
        UUID booking = startingInMinutes(MEMBER_CARD, 5);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-not-offered"))
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.cardDoesNotHold"));
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].doorHold").doesNotExist());
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenATrainingAnHourAhead_whenItsTrainerHoldsTheDoorsOpen_thenTheConflictSaysTheWindowIsClosed()
            throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 60);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-closed"))
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.closed"))
                .andExpect(jsonPath("$.violations[0].params.opensMinutesBefore").value(15));
    }

    @Test
    void givenAnotherMember_whenTheyHoldTheTrainingsDoorsOpen_thenTheBookingIsNotFoundForThem() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                        .with(user("doe.jane").roles("MEMBER")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
    }

    @Test
    void givenACoveringTrainer_whenTheyHoldAnotherTrainersDoorsOpen_thenTheHoldRunsAndOnlyTheyOrTheBoardEndIt()
            throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                        .with(user("miles.richard").roles("TRAINER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.heldByMe").value(true));

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                        .with(user("roe.john").roles("TRAINER")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.alreadyHeld"));
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                        .with(user("roe.john").roles("TRAINER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-not-holder"))
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.notHolder"));
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                        .with(user("major.mary").roles("ADMIN")))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/my/bookings").with(user("roe.john").roles("TRAINER")))
                .andExpect(jsonPath("$.items[0].doorHold.opensAt").value("2026-05-12T09:50:00Z"))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").doesNotExist());
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenARunningHold_whenItsHolderChecksOut_thenNothingIsHeldAndASecondCheckOutIsRefused() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isOk());

        // when
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].doorHold.opensAt").value("2026-05-12T09:50:00Z"))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").doesNotExist());
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-not-running"))
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.notRunning"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAHoldNobodyEnded_whenTheBookingIsOver_thenNothingIsHeldOpen() throws Exception {
        // given
        UUID booking = bookings.insertBookingThatHasStarted(court, campCard,
                new TimeSlot(NOW.minus(90, ChronoUnit.MINUTES), NOW.minus(30, ChronoUnit.MINUTES)), trainer);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(80, ChronoUnit.MINUTES));

        // when / then
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.notRunning"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenARunningHold_whenTheTrainingMovesToTomorrow_thenItHoldsNothingOpen() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isOk());

        // when
        bookings.moveRecorded(booking, Duration.ofDays(1));

        // then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").doesNotExist())
                .andExpect(jsonPath("$.items[0].doorHold.opensAt").value("2026-05-13T09:50:00Z"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenARunningHold_whenTheTrainingIsCancelled_thenTheHoldCannotBeEndedBecauseNothingRuns() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isOk());

        // when
        bookings.cancelRecorded(booking);

        // then
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.notRunning"));
    }

    @Test
    void givenACoveringTrainer_whenTheyOpenTheManagedAppointment_thenItOffersTheDoorHoldWindow() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);

        // when / then
        mockMvc.perform(get("/api/managed/bookings/{id}", booking).with(user("miles.richard").roles("TRAINER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.doorHold.opensAt").value("2026-05-12T09:50:00Z"))
                .andExpect(jsonPath("$.doorHold.heldByMe").value(false))
                .andExpect(jsonPath("$.doorHold.heldSince").doesNotExist());
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenOwnRunningHold_whenTheTrainerHoldsTheDoorsOpenAgain_thenTheSameHoldKeepsRunning() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isOk());

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.heldSince").value("2026-05-12T10:00:00Z"))
                .andExpect(jsonPath("$.heldByMe").value(true));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAnEndedHold_whenTheTrainerChecksInAgain_thenANewHoldRuns() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isOk());
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isNoContent());

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.heldSince").value("2026-05-12T10:00:00Z"));
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").value("2026-05-12T10:00:00Z"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenACancelledTraining_whenItsTrainerHoldsTheDoorsOpen_thenTheConflictSaysTheWindowIsClosed()
            throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        bookings.cancelRecorded(booking);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.closed"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenTheWindowOpensThisMoment_whenTheTrainerHoldsTheDoorsOpen_thenTheHoldStarts() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 15);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.opensAt").value("2026-05-12T10:00:00Z"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenATrainingEndingThisMoment_whenItsTrainerHoldsTheDoorsOpen_thenTheWindowIsClosed() throws Exception {
        // given
        UUID booking = bookings.insertBookingThatHasStarted(court, campCard,
                new TimeSlot(NOW.minus(1, ChronoUnit.HOURS), NOW), trainer);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.closed"));
    }

    @Test
    void givenTheBoard_whenAnAdministratorWhoDidNotBookHoldsTheDoorsOpen_thenTheHoldRuns() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                        .with(user("major.mary").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.heldByMe").value(true));
    }

    @Test
    void givenARunningHold_whenAnotherMemberEndsIt_thenTheBookingIsNotFoundForThemAndTheHoldRuns() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                .with(user("roe.john").roles("TRAINER"))).andExpect(status().isOk());

        // when / then
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                        .with(user("doe.jane").roles("MEMBER")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
        mockMvc.perform(get("/api/my/bookings").with(user("roe.john").roles("TRAINER")))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").value("2026-05-12T10:00:00Z"));
    }

    @Test
    void givenACoveringTrainersHold_whenTheBookerReadsTheirBooking_thenTheHoldShowsAsSomebodyElses() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                .with(user("miles.richard").roles("TRAINER"))).andExpect(status().isOk());

        // when / then
        mockMvc.perform(get("/api/my/bookings").with(user("roe.john").roles("TRAINER")))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").value("2026-05-12T10:00:00Z"))
                .andExpect(jsonPath("$.items[0].doorHold.heldByMe").value(false));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAHoldDroppedByAMove_whenANewHoldEndsAndTheBookingMovesBack_thenTheOldHoldStaysOver() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(8, ChronoUnit.MINUTES));
        bookings.moveRecorded(booking, Duration.ofMinutes(5));
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isOk());
        mockMvc.perform(delete("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isNoContent());

        // when
        bookings.moveRecorded(booking, Duration.ofMinutes(-5));

        // then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].doorHold.opensAt").value("2026-05-12T09:50:00Z"))
                .andExpect(jsonPath("$.items[0].doorHold.heldSince").doesNotExist());
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenARunningHold_whenItsTrainerCancelsTheTraining_thenTheHoldIsEndedAndTheEndAudited() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())).andExpect(status().isOk());

        // when
        bookings.cancelBooking(booking, trainer, Set.of(Role.TRAINER));

        // then
        assertThat(unendedHoldsOf(booking)).as("a cancellation ends the hold rather than leaving it to the window").isZero();
        assertThat(auditedEnds(booking)).isEqualTo(1L);
    }

    @Test
    void givenARunningHold_whenItsBookingMovesToAnotherCourtInTheSameSlot_thenTheHoldIsEnded() throws Exception {
        // given
        UUID booking = startingInMinutes(campCard, 5);
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf())
                .with(user("roe.john").roles("TRAINER"))).andExpect(status().isOk());

        // when
        transactions.executeWithoutResult(status -> events.publishEvent(new SeriesMoved(UUID.randomUUID(),
                List.of(booking), trainer, NOW.plus(5, ChronoUnit.MINUTES), NOW.plus(65, ChronoUnit.MINUTES),
                List.of(court))));

        // then
        assertThat(unendedHoldsOf(booking)).as("the doors of the old court are no longer the booking's").isZero();
        assertThat(auditedEnds(booking)).isEqualTo(1L);
    }

    @Test
    @WithMockUser(username = "roe.richard", roles = "EXTERNAL")
    void givenAnExternalPlayersOwnBookingOnAHoldingCard_whenTheyHoldTheDoorsOpen_thenOutsidersAreRefused()
            throws Exception {
        // given
        UUID external = identity.createEnabledAccount(identity.createPerson("Richard", "Roe", "roe@example.org"),
                "roe.richard", Set.of(Role.EXTERNAL));
        UUID guestCard = cards.createBookingCard("Guest hour", Set.of(Role.EXTERNAL), Set.of());
        cards.letBookingsHoldDoorsOpen(guestCard, true);
        Instant start = NOW.plus(5, ChronoUnit.MINUTES);
        UUID booking = bookings.insertBookingThatHasStarted(court, guestCard,
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)), external);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/door-hold", booking).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(unendedHoldsOf(booking)).as("an external player holds no door open").isZero();
    }

    private long unendedHoldsOf(UUID booking) {
        return jdbc.sql("SELECT count(*) FROM door_hold WHERE booking_id = :id AND ended_at IS NULL")
                .param("id", booking).query(Long.class).single();
    }

    private long auditedEnds(UUID booking) {
        return jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'booking.doorHold.ended' AND subject_id = :id")
                .param("id", booking).query(Long.class).single();
    }

    private UUID startingInMinutes(UUID card, int minutes) {
        Instant start = NOW.plus(minutes, ChronoUnit.MINUTES);
        return bookings.insertBookingThatHasStarted(court, card, new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)),
                trainer);
    }
}
