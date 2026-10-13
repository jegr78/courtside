package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.card.ParticipantCard;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class PartnerSearchControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID BALL_MACHINE = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final TimeSlot SLOT = new TimeSlot(Instant.parse("2026-05-13T16:00:00Z"),
            Instant.parse("2026-05-13T17:00:00Z"));

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingService bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID court;
    private Account holder;
    private Account seeker;

    record Account(UUID accountId, UUID personId) {
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        court = facility.createCourt(1, "Court 1");
        holder = account("Jane", "Doe", "doe.jane");
        seeker = account("John", "Roe", "roe.john");
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABookingLookingForAPartner_whenItsHolderOffersThePlace_thenTheirBookingSaysSo() throws Exception {
        // given
        UUID booking = book(List.of(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER)));
        mockMvc.perform(get("/api/my/bookings").param("view", "UPCOMING"))
                .andExpect(jsonPath("$.items[0].partnerSearch").value("AVAILABLE"));

        // when
        mockMvc.perform(put("/api/my/bookings/{id}/partner-invitation", booking).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/my/bookings").param("view", "UPCOMING"))
                .andExpect(jsonPath("$.items[0].partnerSearch").value("PUBLISHED"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABookingWithoutTheMarker_whenItsHolderOffersAPlace_thenThereIsNoneToOffer() throws Exception {
        // given
        UUID booking = book(List.of(ParticipantSpec.card(BALL_MACHINE)));
        mockMvc.perform(get("/api/my/bookings").param("view", "UPCOMING"))
                .andExpect(jsonPath("$.items[0].partnerSearch").doesNotExist());

        // when / then
        mockMvc.perform(put("/api/my/bookings/{id}/partner-invitation", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:partner-place-unavailable"))
                .andExpect(jsonPath("$.violations[0].code").value("partner.place.none"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "MEMBER")
    void givenSomebodyElsesBooking_whenAMemberOffersOrWithdrawsItsPlace_thenTheBookingIsNotFound() throws Exception {
        // given
        UUID booking = book(List.of(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER)));

        // when / then
        mockMvc.perform(put("/api/my/bookings/{id}/partner-invitation", booking).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
        mockMvc.perform(delete("/api/my/bookings/{id}/partner-invitation", booking).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-found"));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "MEMBER")
    void givenAnOfferedPlace_whenAMemberListsOpenPlaces_thenTheEntryNamesNoPersonAndNoBooking() throws Exception {
        // given
        UUID booking = offeredPlace();

        // when
        String body = mockMvc.perform(get("/api/partner-invitations"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].courtIds[0]").value(court.toString()))
                .andExpect(jsonPath("$[0].startsAt").value("2026-05-13T16:00:00Z"))
                .andExpect(jsonPath("$[0].cardLabel").value("Mitgliederbuchung"))
                .andReturn().getResponse().getContentAsString();

        // then
        JsonNode entry = JsonMapper.builder().build().readTree(body).get(0);
        assertThat(entry.propertyNames())
                .as("the slot, the courts and the card are all that is offered")
                .containsExactlyInAnyOrder("invitationId", "courtIds", "startsAt", "endsAt", "cardLabel");
        assertThat(body).doesNotContain(booking.toString(), "Jane", "Doe", holder.personId().toString());
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "MEMBER")
    void givenAnOfferedPlace_whenAMemberTakesIt_thenTheyPlayAndTheListIsEmpty() throws Exception {
        // given
        UUID booking = offeredPlace();
        String invitation = jdbc.sql("SELECT id FROM partner_invitation").query(String.class).single();

        // when
        mockMvc.perform(post("/api/partner-invitations/{id}/acceptance", invitation).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        assertThat(jdbc.sql("""
                        SELECT count(*) FROM booking_participant WHERE booking_id = :booking AND person_id = :person
                        """).param("booking", booking).param("person", seeker.personId())
                .query(Integer.class).single()).isOne();
        mockMvc.perform(get("/api/partner-invitations")).andExpect(jsonPath("$", hasSize(0)));
        mockMvc.perform(post("/api/partner-invitations/{id}/acceptance", invitation).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:partner-invitation-not-found"));
    }

    @Test
    void givenNoSession_whenOpenPlacesAreListed_thenTheRequestIsRefused() throws Exception {
        // given
        offeredPlace();

        // when / then
        mockMvc.perform(get("/api/partner-invitations"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    private UUID offeredPlace() {
        UUID booking = book(List.of(ParticipantSpec.card(ParticipantCard.LOOKING_FOR_A_PARTNER)));
        jdbc.sql("""
                        INSERT INTO partner_invitation (id, booking_id, participant_id, published_at)
                        SELECT :id, booking_id, id, now() FROM booking_participant WHERE booking_id = :booking
                          AND card_id = :marker
                        """)
                .param("id", UUID.randomUUID()).param("booking", booking)
                .param("marker", ParticipantCard.LOOKING_FOR_A_PARTNER).update();
        return booking;
    }

    private UUID book(List<ParticipantSpec> participants) {
        return bookings.create(new CreateBookingCommand(List.of(court), MEMBER_CARD, SLOT, holder.accountId(),
                holder.personId(), Set.of(Role.MEMBER), null, participants, null));
    }

    private Account account(String firstName, String lastName, String username) {
        UUID person = identity.createPerson(firstName, lastName, username + "@example.org");
        return new Account(identity.createEnabledAccount(person, username, passwordEncoder.encode("secret"),
                Set.of(Role.MEMBER)), person);
    }
}
