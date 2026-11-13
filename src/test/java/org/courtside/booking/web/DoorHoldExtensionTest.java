package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.card.testfixture.CardTestFixture;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DoorHoldExtensionTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");
    private static final Instant ENDS = NOW.plus(30, ChronoUnit.MINUTES);
    private static final Instant EXTENDED = ENDS.plus(30, ChronoUnit.MINUTES);

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
    private ConfigTestFixture configs;

    @Autowired
    private RulesTestFixture rules;

    private MockMvc mockMvc;
    private UUID court;
    private UUID otherCourt;
    private UUID trainer;
    private UUID member;
    private UUID campCard;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        court = facility.createCourt(1, "Court 1");
        otherCourt = facility.createCourt(2, "Court 2");
        trainer = identity.createEnabledAccount(identity.createPerson("John", "Roe", "john@example.org"), "roe.john",
                Set.of(Role.TRAINER));
        identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary@example.org"), "major.mary",
                Set.of(Role.ADMIN));
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles", "richard@example.org"),
                "miles.richard", Set.of(Role.TRAINER));
        member = identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane@example.org"), "doe.jane",
                Set.of(Role.MEMBER));
        campCard = cards.createBookingCard("Holiday camp", Set.of(Role.TRAINER), Set.of(Role.TRAINER));
        cards.letBookingsHoldDoorsOpen(campCard, true);
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenARunningTrainingWithItsTrainerCheckedIn_whenTheTrainerExtendsIt_thenItEndsHalfAnHourLaterAndTheExtensionIsAudited()
            throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));

        // when
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closesAt").value("2026-05-12T11:00:00Z"))
                .andExpect(jsonPath("$.heldSince").value("2026-05-12T09:30:00Z"))
                .andExpect(jsonPath("$.heldByMe").value(true))
                .andExpect(jsonPath("$.extensionEndsAt").value("2026-05-12T11:30:00Z"));

        // then
        assertThat(endsOf(booking)).as("the court is occupied until the new end").containsExactly(EXTENDED);
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].doorHold.closesAt").value("2026-05-12T11:00:00Z"))
                .andExpect(jsonPath("$.items[0].doorHold.heldByMe").value(true));
        assertThat(jdbc.sql("""
                        SELECT payload ->> 'previousEndsAt' FROM domain_event
                        WHERE event_type = 'booking.extended' AND subject_id = :id
                        """).param("id", booking).query(String.class).list())
                .as("the change log keeps the end the extension replaced").containsExactly("2026-05-12T10:30:00Z");
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAnExtensionAlreadyApplied_whenTheSameRequestArrivesAgain_thenTheBookingIsExtendedOnlyOnce()
            throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));
        mockMvc.perform(extend(booking, EXTENDED)).andExpect(status().isOk());

        // when
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closesAt").value("2026-05-12T11:00:00Z"));

        // then
        assertThat(endsOf(booking)).containsExactly(EXTENDED);
        assertThat(extensionsAudited(booking)).isEqualTo(1L);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenARunningTraining_whenTheRequestedEndIsNotHalfAnHourPastTheCurrentOne_thenTheConflictNamesTheCurrentEnd()
            throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));

        // when / then
        mockMvc.perform(extend(booking, EXTENDED.plus(30, ChronoUnit.MINUTES)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-extension-refused"))
                .andExpect(jsonPath("$.violations[0].code").value("booking.extension.stale"))
                .andExpect(jsonPath("$.violations[0].params.endsAt").value("2026-05-12T10:30:00Z"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAMemberBookingOnTheNextHalfHourOfOneOfTwoCourts_whenTheTrainerExtends_thenTheConflictSaysTheCourtIsTaken()
            throws Exception {
        // given
        UUID booking = heldTraining(List.of(court, otherCourt));
        bookings.insertBookingThatHasStarted(otherCourt, MEMBER_CARD, new TimeSlot(ENDS, EXTENDED), member);

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-extension-refused"))
                .andExpect(jsonPath("$.violations[0].code").value("booking.extension.courtTaken"));
        assertThat(endsOf(booking)).as("neither court is extended").containsExactly(ENDS, ENDS);
        assertThat(extensionsAudited(booking)).isZero();
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenTheClubClosingAtTheBookingsEnd_whenTheTrainerExtends_thenTheOpeningHoursRuleRefusesIt()
            throws Exception {
        // given
        facility.setOpeningHours(DayOfWeek.TUESDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(12, 30)));
        UUID booking = heldTraining(List.of(court));

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.violations[0].code").value("booking.rule.openingHours.outside"))
                .andExpect(jsonPath("$.violations.length()").value(1));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "miles.richard", roles = "TRAINER")
    void givenAnotherTrainersRunningHold_whenACoveringTrainerExtends_thenOnlyTheCheckedInPersonMay() throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-not-holder"))
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.notHolder"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenARunningTrainingNobodyCheckedInTo_whenItsTrainerExtends_thenTheConflictSaysNoHoldRuns() throws Exception {
        // given
        UUID booking = bookings.insertBookingThatHasStarted(court, campCard,
                new TimeSlot(NOW.minus(30, ChronoUnit.MINUTES), ENDS), trainer);

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-not-running"))
                .andExpect(jsonPath("$.violations[0].code").value("doorHold.notRunning"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAClubBookingInHourSlots_whenTheTrainerReadsAndExtendsTheHold_thenTheStepIsOneWholeSlot() throws Exception {
        // given
        configs.bookInSlotsOf(60);
        UUID booking = bookings.insertBookingThatHasStarted(court, campCard,
                new TimeSlot(NOW.minus(60, ChronoUnit.MINUTES), NOW.plus(60, ChronoUnit.MINUTES)), trainer);
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(60, ChronoUnit.MINUTES));
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].doorHold.extensionEndsAt").value("2026-05-12T12:00:00Z"));

        // when / then
        mockMvc.perform(extend(booking, NOW.plus(120, ChronoUnit.MINUTES)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.closesAt").value("2026-05-12T12:00:00Z"));
        assertThat(endsOf(booking)).as("half an hour is no whole hour slot").containsExactly(NOW.plus(120, ChronoUnit.MINUTES));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenTrainersBoundToAnHourAtMost_whenTheTrainerExtendsAnHourTraining_thenTheDurationRuleRefusesIt()
            throws Exception {
        // given
        configs.bindPeopleWithoutAMembershipTypeTo(rules.ruleSetBoundingBookingDuration("Short sessions", 60));
        UUID booking = heldTraining(List.of(court));

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.violations[0].code").value("booking.rule.maxBookingDuration.exceeded"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenACharge_whenTheTrainerExtends_thenTheConflictSaysAChargedBookingStays() throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));
        jdbc.sql("UPDATE booking SET amount_minor = 1500, amount_currency = 'EUR' WHERE id = :id")
                .param("id", booking).update();

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-extension-refused"))
                .andExpect(jsonPath("$.violations[0].code").value("booking.extension.charged"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenACardThatStoppedHoldingDoors_whenTheTrainerExtends_thenTheConflictSaysTheCardOffersNoHold()
            throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));
        cards.letBookingsHoldDoorsOpen(campCard, false);

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-not-offered"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenATrainersRunningHold_whenAnAdministratorExtends_thenOnlyTheCheckedInPersonMay() throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:door-hold-not-holder"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenATrainersRunningHold_whenAMemberWhoMayNotManageItExtends_thenTheBookingIsNotFound() throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "roe.richard", roles = "EXTERNAL")
    void givenAnExternalPlayersOwnHold_whenTheyExtend_thenOutsidersAreRefused() throws Exception {
        // given
        UUID external = identity.createEnabledAccount(identity.createPerson("Richard", "Roe", "roe@example.org"),
                "roe.richard", Set.of(Role.EXTERNAL));
        UUID guestCard = cards.createBookingCard("Guest hour", Set.of(Role.EXTERNAL), Set.of());
        cards.letBookingsHoldDoorsOpen(guestCard, true);
        UUID booking = bookings.insertBookingThatHasStarted(court, guestCard,
                new TimeSlot(NOW.minus(30, ChronoUnit.MINUTES), ENDS), external);
        bookings.holdDoorsOpenAt(booking, external, NOW.minus(30, ChronoUnit.MINUTES));

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenADeactivatedCard_whenTheTrainerExtends_thenTheCardIsNoLongerBookable() throws Exception {
        // given
        UUID booking = heldTraining(List.of(court));
        cards.deactivateBookingCard(campCard);

        // when / then
        mockMvc.perform(extend(booking, EXTENDED))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-not-bookable"))
                .andExpect(jsonPath("$.violations[0].code").value("card.inactive"));
        assertThat(endsOf(booking)).containsExactly(ENDS);
    }

    private UUID heldTraining(List<UUID> courts) {
        UUID booking = bookings.insertBookingThatHasStarted(courts.getFirst(), campCard,
                new TimeSlot(NOW.minus(30, ChronoUnit.MINUTES), ENDS), trainer);
        courts.stream().skip(1).forEach(other -> bookings.allocateAnotherCourt(booking, other));
        bookings.holdDoorsOpenAt(booking, trainer, NOW.minus(30, ChronoUnit.MINUTES));
        return booking;
    }

    private org.springframework.test.web.servlet.RequestBuilder extend(UUID booking, Instant endsAt) {
        return post("/api/my/bookings/{id}/door-hold/extension", booking).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content("{\"endsAt\":\"" + endsAt + "\"}");
    }

    private List<Instant> endsOf(UUID booking) {
        return jdbc.sql("SELECT ends_at FROM court_allocation WHERE booking_id = :id")
                .param("id", booking).query(Instant.class).list();
    }

    private long extensionsAudited(UUID booking) {
        return jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'booking.extended' AND subject_id = :id")
                .param("id", booking).query(Long.class).single();
    }
}
