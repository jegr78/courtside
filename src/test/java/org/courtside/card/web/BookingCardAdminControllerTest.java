package org.courtside.card.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.card.CardService;
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
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class BookingCardAdminControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CardService cardService;

    @Autowired
    private BookingService bookingService;

    @Autowired
    private BookingRepository bookings;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void whenCreatingABookingCard_thenItIsListedWithEveryPropertyItWasGiven() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Taster session", "color": "#c8a415",
                                 "requiredRole": "TRAINER", "allowedPlayerCounts": [2, 4],
                                 "countsAgainstLimits": false, "guestAllowed": true}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.label").value("Taster session"))
                .andExpect(jsonPath("$.requiredRole").value("TRAINER"))
                .andExpect(jsonPath("$.allowedPlayerCounts[0]").value(2))
                .andExpect(jsonPath("$.allowedPlayerCounts[1]").value(4))
                .andExpect(jsonPath("$.tracksPlayers").value(true))
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void whenCreatingABookingCard_thenTheLocationHeaderResolvesToTheCreatedCard() throws Exception {
        // given
        MvcResult created = mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Taster session", "color": "#c8a415",
                                 "requiredRole": "TRAINER", "allowedPlayerCounts": [2, 4],
                                 "countsAgainstLimits": false, "guestAllowed": true}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn();
        String location = created.getResponse().getHeader("Location");
        String id = location.substring(location.lastIndexOf('/') + 1);

        // when / then
        mockMvc.perform(get(location))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.label").value("Taster session"))
                .andExpect(jsonPath("$.requiredRole").value("TRAINER"));
    }

    @Test
    void givenAnUnknownBookingCard_whenGettingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/booking-cards/" + UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-not-found"))
                .andExpect(jsonPath("$.title").value("Card not found"));
    }

    @Test
    void whenCreatingABookingCardWithNoPlayerCounts_thenItReportsItDoesNotTrackPlayers() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Court maintenance", "color": "#c8a415",
                                 "allowedPlayerCounts": [], "countsAgainstLimits": false,
                                 "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tracksPlayers").value(false));
    }

    @Test
    void whenCreatingABookingCardWithARepeatedPlayerCount_thenItIsRejectedWithTheApisOwnViolationShape()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Odd card", "color": "#c8a415",
                                 "allowedPlayerCounts": [2, 2], "countsAgainstLimits": false,
                                 "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("allowedPlayerCounts"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NoDuplicates"));
    }

    @Test
    void whenCreatingABookingCardWithANullPlayerCount_thenItIsRejectedWithTheApisOwnViolationShape()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Null count card", "color": "#c8a415",
                                 "allowedPlayerCounts": [2, null], "countsAgainstLimits": false,
                                 "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors").isArray())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("allowedPlayerCounts[1]"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.TypeMismatch"));
    }

    @Test
    void whenCreatingABookingCardWithNoColor_thenItIsRejectedWithTheApisOwnViolationShape()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Colorless card",
                                 "allowedPlayerCounts": [], "countsAgainstLimits": false,
                                 "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("color"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotNull"));
    }

    @Test
    void whenCreatingABookingCardWithAnUnknownRole_thenItIsRejectedWithTheApisOwnViolationShape()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "President's card", "color": "#c8a415",
                                 "requiredRole": "PRESIDENT", "allowedPlayerCounts": [],
                                 "countsAgainstLimits": false, "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("requiredRole"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.TypeMismatch"));
    }

    @Test
    void givenADeactivatedBookingCard_whenListing_thenTheAdminListStillShowsItButTheActiveListDoesNot()
            throws Exception {
        // given
        String id = createCard("Guest card", "#c8a415");

        // when
        mockMvc.perform(put("/api/admin/booking-cards/" + id + "/active")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        // then
        mockMvc.perform(get("/api/admin/booking-cards"))
                .andExpect(jsonPath("$[?(@.id=='" + id + "')]").isNotEmpty());
        assertThat(cardService.activeCards())
                .extracting(card -> card.getId().toString())
                .doesNotContain(id);
    }

    @Test
    void givenABookingUsingACard_whenChangingTheCardsLabel_thenTheBookingStillResolvesAndStaysConfirmed()
            throws Exception {
        // given
        String id = createCard("Match play", "#3a4a5c");
        UUID courtId = courts.save(new Court(1, "Court 1")).getId();
        UUID personId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        Instant sixPm = Instant.parse("2026-05-12T16:00:00Z");
        Instant sevenPm = Instant.parse("2026-05-12T17:00:00Z");
        UUID bookingId = bookingService.create(new CreateBookingCommand(
                List.of(courtId), UUID.fromString(id), new TimeSlot(sixPm, sevenPm),
                UUID.randomUUID(), personId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Partner")), null));

        // when
        mockMvc.perform(put("/api/admin/booking-cards/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Match play (renamed)", "color": "#3a4a5c",
                                 "allowedPlayerCounts": [2, 4], "countsAgainstLimits": false,
                                 "guestAllowed": true}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.label").value("Match play (renamed)"));

        // then
        Booking booking = bookings.findWithAllocationsById(bookingId).orElseThrow();
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(booking.getCardId()).isEqualTo(UUID.fromString(id));
    }

    @Test
    void givenABookingCard_whenCreatingASecondWithTheSameLabel_thenItIsAConflict() throws Exception {
        // given
        createCard("Taster session", "#c8a415");

        // when / then
        mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Taster session", "color": "#3a4a5c",
                                 "allowedPlayerCounts": [], "countsAgainstLimits": false,
                                 "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-label-taken"));
    }

    @Test
    void givenTwoBookingCards_whenRenamingOneOntoTheOthersLabel_thenItIsAConflict() throws Exception {
        // given
        createCard("Taster session", "#c8a415");
        String id = createCard("Odd card", "#3a4a5c");

        // when / then
        mockMvc.perform(put("/api/admin/booking-cards/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Taster session", "color": "#3a4a5c",
                                 "allowedPlayerCounts": [], "countsAgainstLimits": false,
                                 "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-label-taken"));
    }

    @Test
    void givenAnUnknownBookingCard_whenUpdatingIt_thenItIsNotFound() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/booking-cards/" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "Nothing", "color": "#c8a415",
                                 "allowedPlayerCounts": [], "countsAgainstLimits": false,
                                 "guestAllowed": false}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.title").value("Card not found"));
    }

    private String createCard(String label, String color) throws Exception {
        String body = mockMvc.perform(post("/api/admin/booking-cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"label": "%s", "color": "%s",
                                 "allowedPlayerCounts": [2, 4], "countsAgainstLimits": false,
                                 "guestAllowed": true}
                                """.formatted(label, color))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.id");
    }
}
