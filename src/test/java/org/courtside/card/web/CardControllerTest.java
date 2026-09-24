package org.courtside.card.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.card.BookingCard;
import org.courtside.card.CardService;
import org.courtside.card.ParticipantCard;
import org.courtside.identity.Role;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "jane.doe", roles = "MEMBER")
class CardControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CardService cards;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAnAnonymousCaller_whenListingBookingCardsPublicly_thenItIsUnauthorized() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/booking-cards").with(anonymous()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenRoleRestrictedAndInactiveCards_whenListingTheLegend_thenEveryActiveCardIsPublic() throws Exception {
        // given
        BookingCard restricted = cards.createCard("Trainer session", "#3a4a5c", Set.of(Role.TRAINER), Set.of(),
                new short[0], false, false, false);
        BookingCard retired = cards.createCard("Retired card", "#c8a415", Set.of(), Set.of(),
                new short[0], false, false, false);
        cards.setCardActive(retired.getId(), false);

        // when / then
        mockMvc.perform(get("/api/public/booking-card-legend").with(anonymous()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + restricted.getId() + "')].label")
                        .value("Trainer session"))
                .andExpect(jsonPath("$[?(@.id=='" + restricted.getId() + "')].color")
                        .value("#3a4a5c"))
                .andExpect(jsonPath("$[?(@.id=='" + restricted.getId() + "')].showGenericOccupancy")
                        .value(false))
                .andExpect(jsonPath("$[?(@.id=='" + retired.getId() + "')]").isEmpty());
    }

    @Test
    void whenListingTheLegend_thenBookingRulesAreNotExposed() throws Exception {
        // given
        BookingCard card = cards.createCard("Match play", "#3a4a5c", Set.of(Role.TRAINER), Set.of(),
                new short[] {2, 4}, true, true, true);
        String at = "$[?(@.id=='" + card.getId() + "')]";

        // when / then
        mockMvc.perform(get("/api/public/booking-card-legend").with(anonymous()))
                .andExpect(status().isOk())
                .andExpect(jsonPath(at + ".allowedPlayerCounts").doesNotExist())
                .andExpect(jsonPath(at + ".guestAllowed").doesNotExist())
                .andExpect(jsonPath(at + ".allowedRoles").doesNotExist())
                .andExpect(jsonPath(at + ".managingRoles").doesNotExist());
    }

    @Test
    void givenGenericCards_whenListingTheLegend_thenTheyBecomeOneNeutralEntry() throws Exception {
        // given
        cards.createCard("Private rehabilitation", "#123456", Set.of(Role.TRAINER), Set.of(),
                new short[0], false, false, true);
        cards.createCard("Confidential coaching", "#654321", Set.of(Role.TRAINER), Set.of(),
                new short[0], false, false, true);

        // when / then
        mockMvc.perform(get("/api/public/booking-card-legend").with(anonymous()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.showGenericOccupancy==true)]")
                        .value(org.hamcrest.Matchers.hasSize(1)))
                .andExpect(jsonPath("$[?(@.showGenericOccupancy==true)].id")
                        .value(org.hamcrest.Matchers.contains((Object) null)))
                .andExpect(jsonPath("$[?(@.showGenericOccupancy==true)].label").value("?"))
                .andExpect(jsonPath("$[?(@.showGenericOccupancy==true)].color").value("#999999"))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("Private rehabilitation"))))
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("Confidential coaching"))));
    }

    @Test
    void givenAnAnonymousCaller_whenListingParticipantCardsPublicly_thenItIsUnauthorized() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/participant-cards").with(anonymous()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenAnActiveAndADeactivatedBookingCard_whenListingPublicly_thenOnlyTheActiveOneIsPresent()
            throws Exception {
        // given
        BookingCard active = cards.createCard("Match play", "#3a4a5c", Set.of(), Set.of(),
                new short[] {2, 4}, true, true, true);
        BookingCard retired = cards.createCard("Retired card", "#c8a415", Set.of(), Set.of(),
                new short[0], false, false, false);
        cards.setCardActive(retired.getId(), false);

        // when / then
        mockMvc.perform(get("/api/public/booking-cards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + active.getId() + "')]").isNotEmpty())
                .andExpect(jsonPath("$[?(@.id=='" + retired.getId() + "')]").isEmpty());
    }

    @Test
    void givenACardGatedBehindARoleTheCallerDoesNotHold_whenListingPublicly_thenItIsAbsent()
            throws Exception {
        // given
        BookingCard gated = cards.createCard("Trainer session", "#3a4a5c", Set.of(Role.TRAINER), Set.of(),
                new short[0], false, false, false);
        BookingCard open = cards.createCard("Match play", "#3a4a5c", Set.of(), Set.of(),
                new short[] {2, 4}, true, true, true);

        // when / then
        mockMvc.perform(get("/api/public/booking-cards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + gated.getId() + "')]").isEmpty())
                .andExpect(jsonPath("$[?(@.id=='" + open.getId() + "')]").isNotEmpty());
    }

    @Test
    void whenListingBookingCardsPublicly_thenOnlyMemberFacingFieldsAreExposed() throws Exception {
        // given
        BookingCard card = cards.createCard(
                "Match play", "#3a4a5c", Set.of(), Set.of(), new short[] {2, 4}, true, true, true);
        String at = "$[?(@.id=='" + card.getId() + "')]";

        // when / then
        mockMvc.perform(get("/api/public/booking-cards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath(at + ".label").value("Match play"))
                .andExpect(jsonPath(at + ".color").value("#3a4a5c"))
                .andExpect(jsonPath(at + ".allowedPlayerCounts[0]").value(2))
                .andExpect(jsonPath(at + ".allowedPlayerCounts[1]").value(4))
                .andExpect(jsonPath(at + ".guestAllowed").value(true))
                .andExpect(jsonPath(at + ".allowedRoles").doesNotExist())
                .andExpect(jsonPath(at + ".active").doesNotExist())
                .andExpect(jsonPath(at + ".tracksPlayers").doesNotExist())
                .andExpect(jsonPath(at + ".countsAgainstLimits").doesNotExist());
    }

    @Test
    void givenAnActiveAndADeactivatedParticipantCard_whenListingPublicly_thenOnlyTheActiveOneIsPresent()
            throws Exception {
        // given
        ParticipantCard active = cards.createParticipantCard("Youth squad", 12);
        ParticipantCard retired = cards.createParticipantCard("Old squad", 8);
        cards.setParticipantCardActive(retired.getId(), false);

        // when / then
        mockMvc.perform(get("/api/public/participant-cards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + active.getId() + "')]").isNotEmpty())
                .andExpect(jsonPath("$[?(@.id=='" + retired.getId() + "')]").isEmpty());
    }

    @Test
    void whenListingParticipantCardsPublicly_thenOnlyMemberFacingFieldsAreExposed() throws Exception {
        // given
        ParticipantCard card = cards.createParticipantCard("Youth squad", 12);
        String at = "$[?(@.id=='" + card.getId() + "')]";

        // when / then
        mockMvc.perform(get("/api/public/participant-cards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath(at + ".label").value("Youth squad"))
                .andExpect(jsonPath(at + ".capacity").value(12))
                .andExpect(jsonPath(at + ".active").doesNotExist());
    }
}
