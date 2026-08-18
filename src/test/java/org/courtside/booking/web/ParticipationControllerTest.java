package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ParticipationControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;
    private UUID courtId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        courtId = courts.save(new Court(1, "Court 1")).getId();
        createAccount("Jane", "Doe", "doe.jane");
        createAccount("Mary", "Major", "major.mary");
    }

    @Test
    void givenAnonymousCaller_whenListingParticipations_thenItIsRefused() throws Exception {
        // when / then
        mockMvc.perform(get("/api/my/participations"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void givenAMemberNamedInSomebodyElsesBooking_whenTheyList_thenTheyFindItWithoutAnyName()
            throws Exception {
        // given
        bookNaming("major.mary", "doe.jane");

        // when / then
        mockMvc.perform(get("/api/my/participations").with(user("major.mary").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].courtIds[0]").value(courtId.toString()))
                .andExpect(jsonPath("$.items[0].startsAt").value("2026-05-12T16:00:00Z"))
                .andExpect(jsonPath("$.items[0].cardLabel").value("Member booking"))
                .andExpect(jsonPath("$.items[0].status").value("CONFIRMED"))
                .andExpect(jsonPath("$.items[0].bookedByName").doesNotExist())
                .andExpect(jsonPath("$.items[0].note").doesNotExist());
    }

    @Test
    void givenTheirOwnBooking_whenTheBookerLists_thenItIsNotAmongTheirParticipations()
            throws Exception {
        // given
        bookNaming("major.mary", "doe.jane");

        // when / then
        mockMvc.perform(get("/api/my/participations").with(user("doe.jane").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void givenAMemberNamedInSomebodyElsesBooking_whenTheyWithdraw_thenTheyAreNoLongerRecorded()
            throws Exception {
        // given
        bookNaming("major.mary", "doe.jane");
        String bookingId = JsonPath.read(
                mockMvc.perform(get("/api/my/participations").with(user("major.mary").roles("MEMBER")))
                        .andReturn().getResponse().getContentAsString(), "$.items[0].id");

        // when
        mockMvc.perform(delete("/api/my/participations/" + bookingId)
                        .with(user("major.mary").roles("MEMBER")).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/my/participations").with(user("major.mary").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void givenABookingTheyAreNotRecordedIn_whenAMemberWithdraws_thenItSaysSoRatherThanJustFailing()
            throws Exception {
        // given
        bookNaming("major.mary", "doe.jane");

        // when / then
        mockMvc.perform(delete("/api/my/participations/" + UUID.randomUUID())
                        .with(user("major.mary").roles("MEMBER")).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:participation-not-found"));
    }

    @Test
    void givenTheirOwnBooking_whenTheBookerWithdrawsFromIt_thenItIsRefusedAsNoParticipation()
            throws Exception {
        // given
        String bookingId = bookNaming("major.mary", "doe.jane");

        // when / then
        mockMvc.perform(delete("/api/my/participations/" + bookingId)
                        .with(user("doe.jane").roles("MEMBER")).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:participation-not-found"));
    }

    private String bookNaming(String namedUsername, String bookerUsername) throws Exception {
        UUID namedPersonId = accounts.findByUsername(namedUsername).orElseThrow()
                .getPerson().getId();
        String response = mockMvc.perform(post("/api/bookings")
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "%s",
                                  "startsAt": "2026-05-12T18:00:00+02:00",
                                  "endsAt": "2026-05-12T19:00:00+02:00",
                                  "note": "Doubles",
                                  "participants": [{ "personId": "%s" }]
                                }
                                """.formatted(courtId, MEMBER_BOOKING_CARD, namedPersonId))
                        .with(user(bookerUsername).roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(response, "$.id");
    }

    private void createAccount(String firstName, String lastName, String username) {
        Person person = persons.save(new Person(firstName, lastName, username + "@example.org"));
        UserAccount account = new UserAccount(
                person, username, passwordEncoder.encode("secret"), Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);
    }
}
