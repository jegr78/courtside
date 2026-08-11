package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingStatus;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BookingControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final String GUEST_PARTICIPANT = "{ \"guestName\": \"Partner\" }";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingRepository bookings;

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
    private UUID secondCourtId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        courtId = courts.save(new Court(1, "Court 1")).getId();
        secondCourtId = courts.save(new Court(2, "Court 2")).getId();

        createAccount("Jane", "Doe", "doe.jane", Role.MEMBER);
        createAccount("Mary", "Major", "major.mary", Role.MEMBER);
        createAccount("Richard", "Miles", "miles.richard", Role.ADMIN);
        createAccount("John", "Roe", "trainer.john", Role.TRAINER);
    }

    private void createAccount(String firstName, String lastName, String username, Role role) {
        Person person = persons.save(
                new Person(firstName, lastName, username + "@example.org"));
        UserAccount account = new UserAccount(
                person, username, passwordEncoder.encode("secret"), Set.of(role));
        account.enable();
        accounts.save(account);
    }

    @Test
    void givenAnonymousCaller_whenListingCourts_thenTheListIsPublic() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/courts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Court 1"));
    }

    @Test
    void givenAnonymousCaller_whenCreatingABooking_thenUnauthorized() throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnAuthenticatedMember_whenCreatingAValidBooking_thenItIsCreated() throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenNoIdempotencyKey_whenCreatingABooking_thenBadRequestIsReturned() throws Exception {
        // when / then
        mockMvc.perform(post("/api/bookings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isBadRequest());

        assertThat(bookings.count()).isZero();
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnInvalidIdempotencyKey_whenCreatingABooking_thenValidationFailureIsReturned()
            throws Exception {
        // when / then
        mockMvc.perform(bookingPost("contains whitespace")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("idempotencyKey"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"))
                .andExpect(jsonPath("$.fieldErrors[0].params").isEmpty());

        assertThat(bookings.count()).isZero();
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenTheSameIdempotencyKeyAndRequest_whenCreatingTwice_thenTheOriginalBookingIsReturned()
            throws Exception {
        // given
        String key = UUID.randomUUID().toString();
        String request = bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00");

        // when
        String first = mockMvc.perform(bookingPost(key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String second = mockMvc.perform(bookingPost(key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        // then
        assertThat(JsonPath.<String>read(second, "$.id"))
                .isEqualTo(JsonPath.<String>read(first, "$.id"));
        assertThat(bookings.count()).isOne();
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenTheSameIdempotencyKeyAndDifferentRequest_whenCreatingAgain_thenConflictIsReturned()
            throws Exception {
        // given
        String key = UUID.randomUUID().toString();
        mockMvc.perform(bookingPost(key)
                        .contentType(MediaType.APPLICATION_JSON)
                .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(bookingPost(key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T19:00:00+02:00", "2026-05-12T20:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:idempotency-key-reused"))
                .andExpect(jsonPath("$.violations[0].code").value("booking.idempotencyKey.reused"));

        assertThat(bookings.count()).isOne();
    }

    @Test
    void givenTwoAccountsUseTheSameIdempotencyKey_whenCreatingDifferentBookings_thenBothAreCreated()
            throws Exception {
        // given
        String key = UUID.randomUUID().toString();

        // when / then
        mockMvc.perform(bookingPost(key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(user("doe.jane").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());
        mockMvc.perform(bookingPost(key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T19:00:00+02:00", "2026-05-12T20:00:00+02:00"))
                        .with(user("major.mary").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        assertThat(bookings.count()).isEqualTo(2);
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABookingStartingInThePast_whenCreating_thenTheViolationCodeIsReturned() throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T11:00:00+02:00",
                                "2026-05-12T12:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-rules-violated"))
                .andExpect(jsonPath("$.violations[*].code")
                        .value(Matchers.contains("booking.rule.startsInPast")));
        assertThat(bookings.count()).isZero();
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABookingBreakingTwoRules_whenCreatingIt_thenBothViolationsAreReported()
            throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T22:10:00+02:00", "2026-05-12T22:50:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.violations.length()").value(2))
                .andExpect(jsonPath("$.violations[*].code").value(Matchers.hasItems(
                        "booking.rule.openingHours.outside",
                        "booking.rule.slotGrid.misaligned")));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnOccupiedSlot_whenBookingItAgain_thenConflictIsReturned() throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.title").value("Court unavailable"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABookingOnADay_whenRequestingThatDaysGrid_thenTheBookingIsListed() throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].cardLabel").value("Member booking"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenOwnAndForeignBookings_whenListingPersonalBookings_thenOnlyOwnDetailsAreReturned()
            throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated());
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T19:00:00+02:00", "2026-05-12T20:00:00+02:00"))
                        .with(user("major.mary").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].courtIds[0]").value(courtId.toString()))
                .andExpect(jsonPath("$.items[0].startsAt").value("2026-05-12T16:00:00Z"))
                .andExpect(jsonPath("$.items[0].endsAt").value("2026-05-12T17:00:00Z"))
                .andExpect(jsonPath("$.items[0].cardLabel").value("Member booking"))
                .andExpect(jsonPath("$.items[0].status").value("CONFIRMED"))
                .andExpect(jsonPath("$.items[0].seriesId").doesNotExist())
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenMorePersonalBookingsThanTheLimit_whenFollowingTheCursor_thenEveryBookingIsReturnedOnce()
            throws Exception {
        // given
        String older = JsonPath.read(mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(), "$.id");
        String newer = JsonPath.read(mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T19:00:00+02:00", "2026-05-12T20:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString(), "$.id");

        // when
        String firstPage = mockMvc.perform(get("/api/my/bookings").param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(newer))
                .andExpect(jsonPath("$.nextCursor").value(newer))
                .andReturn().getResponse().getContentAsString();
        String cursor = JsonPath.read(firstPage, "$.nextCursor");

        // then
        mockMvc.perform(get("/api/my/bookings")
                        .param("limit", "1")
                        .param("cursor", cursor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(older))
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    void givenAnonymousCaller_whenListingPersonalBookings_thenUnauthorized() throws Exception {
        // when / then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenNoPersonalBookings_whenListingThem_thenAnEmptyPageIsReturned() throws Exception {
        // when / then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnOwnBooking_whenCancellingIt_thenItDisappearsFromTheGrid() throws Exception {
        // given
        String response = mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = response.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        // when
        mockMvc.perform(delete("/api/bookings/{id}", id).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12"))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "MEMBER")
    void givenAForeignBooking_whenAMemberCancelsIt_thenForbiddenAndItStaysConfirmed()
            throws Exception {
        // given
        UUID id = bookingOf("doe.jane");

        // when
        mockMvc.perform(delete("/api/bookings/{id}", id).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-owned"));

        // then
        assertThat(bookings.findById(id).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    @WithMockUser(username = "miles.richard", roles = "ADMIN")
    void givenAForeignBooking_whenAnAdminCancelsIt_thenItIsCancelled() throws Exception {
        // given
        UUID id = bookingOf("doe.jane");

        // when
        mockMvc.perform(delete("/api/bookings/{id}", id).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        assertThat(bookings.findById(id).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CANCELLED);
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenACardRequiringATrainer_whenAMemberBooksIt_thenForbidden() throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(trainingJson())
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenACardRequiringATrainer_whenATrainerBooksIt_thenItIsCreated() throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(trainingJson())
                        .with(csrf()))
                .andExpect(status().isCreated());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnEndBeforeItsStart_whenCreatingABooking_thenBadRequest() throws Exception {
        // when / then
        expectBadRequest(bookingJson("2026-05-12T19:00:00+02:00", "2026-05-12T18:00:00+02:00"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnUnknownCard_whenCreatingABooking_thenBadRequest() throws Exception {
        // when / then
        expectBadRequest(bookingJson(courtId, UUID.randomUUID(), GUEST_PARTICIPANT));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnUnknownCourt_whenCreatingABooking_thenBadRequest() throws Exception {
        // when / then
        expectBadRequest(bookingJson(UUID.randomUUID(), MEMBER_BOOKING_CARD, GUEST_PARTICIPANT));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenADeactivatedCourt_whenCreatingABooking_thenBadRequest() throws Exception {
        // given
        Court retired = new Court(9, "Court 9");
        retired.deactivate();
        UUID retiredId = courts.save(retired).getId();

        // when / then
        expectBadRequest(bookingJson(retiredId, MEMBER_BOOKING_CARD, GUEST_PARTICIPANT));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAParticipantIdThatIsNoPerson_whenCreatingABooking_thenBadRequest() throws Exception {
        // when / then
        expectBadRequest(bookingJson(courtId, MEMBER_BOOKING_CARD,
                "{ \"personId\": \"%s\" }".formatted(UUID.randomUUID())));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAParticipantWithBothAnIdAndABlankName_whenCreatingABooking_thenBadRequest()
            throws Exception {
        // when / then
        expectBadRequest(bookingJson(courtId, MEMBER_BOOKING_CARD,
                "{ \"personId\": \"%s\", \"guestName\": \"   \" }".formatted(UUID.randomUUID())));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAMemberCardBookedWithoutAFurtherPlayer_whenCreatingABooking_thenSlotCountIsRejected()
            throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson(courtId, MEMBER_BOOKING_CARD, ""))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.violations[0].code").value("booking.participants.slotCount"))
                .andExpect(jsonPath("$.violations[0].params.cardLabel").value("Member booking"))
                .andExpect(jsonPath("$.violations[0].params.allowed").value("2 / 4"))
                .andExpect(jsonPath("$.violations[0].params.actual").value(1));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenARequestMissingTheCourt_whenCreatingABooking_thenBeanValidationUsesProblemJson()
            throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "cardId": "%s",
                                  "startsAt": "2026-05-12T18:00:00+02:00",
                                  "endsAt": "2026-05-12T19:00:00+02:00"
                                }
                                """.formatted(MEMBER_BOOKING_CARD))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnUnsupportedMethod_whenCallingTheBookingResource_thenProblemJson() throws Exception {
        // when / then
        mockMvc.perform(put("/api/bookings").with(csrf()))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnUnknownBooking_whenCancellingIt_thenNotFound() throws Exception {
        // when / then
        mockMvc.perform(delete("/api/bookings/{id}", UUID.randomUUID()).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABallMachineSlot_whenCreatingABooking_thenItIsCreated() throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "11111111-1111-1111-1111-111111111111",
                                  "startsAt": "2026-05-13T18:00:00+02:00",
                                  "endsAt": "2026-05-13T19:00:00+02:00",
                                  "participants": [
                                    {"cardId": "55555555-5555-5555-5555-555555555555"}
                                  ]
                                }
                                """.formatted(courtId))
                        .with(csrf()))
                .andExpect(status().isCreated());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenASinglesBooking_whenLoadingTheGrid_thenItIsLabelledSingles() throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-13T18:00:00+02:00", "2026-05-13T19:00:00+02:00"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-13"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].matchType").value("SINGLES"))
                .andExpect(jsonPath("$[0].bookedByName").doesNotExist());
    }

    @Test
    void givenOwnBookingWithAnotherMember_whenLoadingTheGrid_thenOnlyOwnershipAndSurnameAreVisible()
            throws Exception {
        // given
        UUID participantId = accounts.findByUsername("major.mary").orElseThrow().getPerson().getId();
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson(courtId, MEMBER_BOOKING_CARD,
                                "{ \"personId\": \"%s\" }".formatted(participantId)))
                        .with(user("doe.jane").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());
        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12")
                        .with(user("doe.jane").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ownBooking").value(true))
                .andExpect(jsonPath("$[0].participantLastNames[0]").value("Major"))
                .andExpect(jsonPath("$[0].bookedByName").doesNotExist());
    }

    @Test
    void givenAnotherMembersBooking_whenLoadingTheGrid_thenOwnershipAndParticipantsAreHidden()
            throws Exception {
        // given
        UUID participantId = accounts.findByUsername("major.mary").orElseThrow().getPerson().getId();
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson(courtId, MEMBER_BOOKING_CARD,
                                "{ \"personId\": \"%s\" }".formatted(participantId)))
                        .with(user("doe.jane").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12")
                        .with(user("major.mary").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ownBooking").value(false))
                .andExpect(jsonPath("$[0].participantLastNames").doesNotExist())
                .andExpect(jsonPath("$[0].bookedByName").doesNotExist());
    }

    @Test
    void givenOwnBookingWithAGuest_whenLoadingTheGrid_thenTheGuestNameIsHidden() throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00",
                                "2026-05-12T19:00:00+02:00"))
                        .with(user("doe.jane").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12")
                        .with(user("doe.jane").roles("MEMBER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ownBooking").value(true))
                .andExpect(jsonPath("$[0].participantLastNames").isEmpty())
                .andExpect(content().string(Matchers.not(Matchers.containsString("Partner"))));
    }

    @Test
    void givenAnonymousCaller_whenLoadingTheGrid_thenOwnershipAndParticipantsAreHidden()
            throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00",
                                "2026-05-12T19:00:00+02:00"))
                        .with(user("doe.jane").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ownBooking").value(false))
                .andExpect(jsonPath("$[0].participantLastNames").doesNotExist())
                .andExpect(jsonPath("$[0].bookedByName").doesNotExist())
                .andExpect(content().string(Matchers.not(Matchers.containsString("Partner"))));
    }

    @Test
    void givenPasswordChangeIsRequired_whenLoadingTheGrid_thenTheAnonymousRepresentationIsReturned()
            throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00",
                                "2026-05-12T19:00:00+02:00"))
                        .with(user("doe.jane").roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated());
        UserAccount account = accounts.findByUsername("doe.jane").orElseThrow();
        account.requirePasswordChange();
        accounts.save(account);

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12")
                        .with(user("doe.jane").authorities(
                                new SimpleGrantedAuthority("ROLE_MEMBER"),
                                new SimpleGrantedAuthority("PASSWORD_CHANGE_REQUIRED"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].ownBooking").value(false))
                .andExpect(jsonPath("$[0].participantLastNames").doesNotExist())
                .andExpect(jsonPath("$[0].bookedByName").doesNotExist())
                .andExpect(content().string(Matchers.not(Matchers.containsString("Partner"))));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenATrainingBookingWithNoParticipants_whenLoadingTheGrid_thenMatchTypeIsNull()
            throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(trainingJson())
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].matchType").doesNotExist());
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenTwoCourts_whenCreatingATrainingBooking_thenTheGridShowsBoth() throws Exception {
        // given
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s", "%s"],
                                  "cardId": "22222222-2222-2222-2222-222222222222",
                                  "startsAt": "2026-05-13T18:00:00+02:00",
                                  "endsAt": "2026-05-13T20:00:00+02:00"
                                }
                                """.formatted(courtId, secondCourtId))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when / then
        mockMvc.perform(get("/api/bookings").param("date", "2026-05-13"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        String body = mockMvc.perform(get("/api/bookings").param("date", "2026-05-13"))
                .andReturn().getResponse().getContentAsString();
        assertThat(JsonPath.<String>read(body, "$[0].bookingId"))
                .isEqualTo(JsonPath.read(body, "$[1].bookingId"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenNoCourtAtAll_whenCreatingABooking_thenBadRequest() throws Exception {
        // when / then
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": [],
                                  "cardId": "11111111-1111-1111-1111-111111111111",
                                  "startsAt": "2026-05-13T18:00:00+02:00",
                                  "endsAt": "2026-05-13T19:00:00+02:00",
                                  "participants": [{"guestName": "John Roe"}]
                                }
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest());
    }

    private void expectBadRequest(String body) throws Exception {
        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    private String trainingJson() {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "%s",
                  "startsAt": "2026-05-12T18:00:00+02:00",
                  "endsAt": "2026-05-12T19:00:00+02:00"
                }
                """.formatted(courtId, TRAINING_CARD);
    }

    private UUID bookingOf(String username) throws Exception {
        String response = mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson("2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                        .with(user(username).roles("MEMBER"))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(response.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));
    }

    private String bookingJson(String start, String end) {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "%s",
                  "startsAt": "%s",
                  "endsAt": "%s",
                  "participants": [ %s ]
                }
                """.formatted(courtId, MEMBER_BOOKING_CARD, start, end, GUEST_PARTICIPANT);
    }

    private MockHttpServletRequestBuilder bookingPost() {
        return bookingPost(UUID.randomUUID().toString());
    }

    private MockHttpServletRequestBuilder bookingPost(String idempotencyKey) {
        return post("/api/bookings").header("Idempotency-Key", idempotencyKey);
    }

    private String bookingJson(UUID court, UUID card, String participant) {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "%s",
                  "startsAt": "2026-05-12T18:00:00+02:00",
                  "endsAt": "2026-05-12T19:00:00+02:00",
                  "participants": [ %s ]
                }
                """.formatted(court, card, participant);
    }
}
