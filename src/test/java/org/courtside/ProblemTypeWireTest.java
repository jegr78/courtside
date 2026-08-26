package org.courtside;

import org.courtside.facility.testfixture.FacilityTestFixture;
import com.jayway.jsonpath.JsonPath;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class ProblemTypeWireTest extends AbstractIntegrationTest {

    private static final Pattern ALLOWED_TYPE = Pattern.compile("^urn:courtside:error:[a-z0-9-]+$");
    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TRAINING_CARD =
            UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facilityFixture;


    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    private MockMvc mockMvc;
    private UUID courtId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        courtId = facilityFixture.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
    }

    @Test
    void givenAMalformedBody_whenPosting_thenTheResponseCarriesItsOwnType() throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(post("/api/admin/booking-cards")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{ not json")
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:malformed-request-body");
    }

    @Test
    void givenABodyFieldThatIsNotAUuid_whenPosting_thenTheResponseNamesTheField() throws Exception {
        // given
        String body = """
                {"courtIds":["%s"],"cardId":"not-a-uuid",
                 "startsAt":"2026-01-05T09:00:00Z","endsAt":"2026-01-05T10:00:00Z"}
                """.formatted(courtId);

        // when
        ResultActions result = mockMvc.perform(bookingPost()
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
        result.andExpect(jsonPath("$.fieldErrors[0].field").value("cardId"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.TypeMismatch"));
    }

    @Test
    void givenAnUnreadableValueInsideAnObjectInAnArray_whenPosting_thenTheFieldCarriesTheIndex()
            throws Exception {
        // given
        String body = """
                {"courtIds":["%s"],"cardId":"%s",
                 "startsAt":"2026-01-05T09:00:00Z","endsAt":"2026-01-05T10:00:00Z",
                 "participants":[{"guestName":"John Roe"},{"personId":"not-a-uuid"}]}
                """.formatted(courtId, MEMBER_BOOKING_CARD);

        // when
        ResultActions result = mockMvc.perform(bookingPost()
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
        result.andExpect(jsonPath("$.fieldErrors[0].field").value("participants[1].personId"));
    }

    @Test
    void givenAnUnreadableValueUnderAKeyThisApiDefines_whenPutting_thenTheKeyNamesTheField()
            throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(put(
                "/api/admin/rule-sets/{id}/rules/{type}", UUID.randomUUID(), "ADVANCE_WINDOW")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"params\":{\"maxDays\":\"not-a-number\"}}")
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
        result.andExpect(jsonPath("$.fieldErrors[0].field").value("params.maxDays"));
    }

    @Test
    void givenAnUndeclaredFieldWithAVeryLongName_whenPutting_thenTheNameComesBackShortened()
            throws Exception {
        // given
        String invented = "x".repeat(500);

        // when
        ResultActions result = mockMvc.perform(put(
                "/api/admin/rule-sets/{id}/rules/{type}", UUID.randomUUID(), "ADVANCE_WINDOW")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"" + invented + "\":\"nope\"}")
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
        result.andExpect(jsonPath("$.fieldErrors[0].code").value("validation.UnknownField"));
        String body = result.andReturn().getResponse().getContentAsString();
        assertThat(body)
                .as("the name is the caller's own text, so it goes back bounded rather than"
                        + " however long they made it")
                .doesNotContain(invented)
                .contains("x".repeat(60));
    }

    @Test
    void givenAnUnreadableValueUnderAKeyTheCallerInvented_whenPutting_thenOnlyTheObjectIsNamed()
            throws Exception {
        // given
        ResultActions result = mockMvc.perform(put(
                "/api/admin/rule-sets/{id}/rules/{type}", UUID.randomUUID(), "ADVANCE_WINDOW")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"params\":{\"<img src=x onerror=alert(1)>\":\"nope\"}}")
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
        result.andExpect(jsonPath("$.fieldErrors[0].field").value("params"));
        assertThat(result.andReturn().getResponse().getContentAsString()).doesNotContain("<img");
    }

    @Test
    void givenADuplicateInAnArrayThatMustBeUnique_whenPosting_thenTheResponseNamesTheField()
            throws Exception {
        // given
        String body = """
                {"courtIds":["%s"],"cardId":"%s","startsOn":"2026-04-07","startTime":"18:00:00",
                 "durationMinutes":120,"intervalWeeks":1,"weekdays":["TUESDAY","TUESDAY"],
                 "occurrenceCount":2,"confirmedStarts":["2026-04-07T18:00:00+02:00"]}
                """.formatted(courtId, TRAINING_CARD);

        // when
        ResultActions result = mockMvc.perform(post("/api/booking-series")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
        result.andExpect(jsonPath("$.fieldErrors[0].field").value("weekdays"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NoDuplicates"));
    }

    @Test
    void givenAnUnreadableValueInsideAnArray_whenPosting_thenTheResponseNamesTheEntry()
            throws Exception {
        // given
        String body = """
                {"courtIds":["not-a-uuid"],"cardId":"%s",
                 "startsAt":"2026-01-05T09:00:00Z","endsAt":"2026-01-05T10:00:00Z"}
                """.formatted(MEMBER_BOOKING_CARD);

        // when
        ResultActions result = mockMvc.perform(bookingPost()
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
        result.andExpect(jsonPath("$.fieldErrors[0].field").value("courtIds[0]"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.TypeMismatch"));
    }

    @Test
    void givenAnUnsupportedMethod_whenRequesting_thenTheAllowHeaderNamesEveryMethodTheEndpointSupports()
            throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(post("/api/admin/config")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}")
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.METHOD_NOT_ALLOWED, "urn:courtside:error:method-not-supported");
        assertThat(headerValues(result, "Allow")).containsExactlyInAnyOrder("GET", "PUT");
    }

    @Test
    void givenAnUnsupportedMethod_whenDeletingAMembershipType_thenTheAllowHeaderNamesPutAndGet()
            throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(
                delete("/api/admin/membership-types/" + UUID.randomUUID()).with(csrf()));

        // then
        assertProblem(result, HttpStatus.METHOD_NOT_ALLOWED, "urn:courtside:error:method-not-supported");
        assertThat(headerValues(result, "Allow")).containsExactlyInAnyOrder("PUT", "GET");
    }

    @Test
    void givenAnUnknownPath_whenRequesting_thenTheResponseCarriesItsOwnType() throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(get("/api/admin/nope"));

        // then
        assertProblem(result, HttpStatus.NOT_FOUND, "urn:courtside:error:unmapped-path");
    }

    @Test
    void givenAFailedValidation_whenPosting_thenTheResponseCarriesItsOwnType() throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(post("/api/admin/booking-cards")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"label": "", "color": "#c8a415",
                         "allowedPlayerCounts": [], "countsAgainstLimits": false,
                         "guestAllowed": false}
                        """)
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:validation-failed");
    }

    @Test
    void givenAnUnknownId_whenSettingARule_thenTheResponseCarriesItsOwnType() throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(
                put("/api/admin/rule-sets/" + UUID.randomUUID() + "/rules/ADVANCE_WINDOW")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"params": {"maxDays": 14}}
                                """)
                        .with(csrf()));

        // then
        assertProblem(result, HttpStatus.NOT_FOUND, "urn:courtside:error:rule-set-not-found");
    }

    @Test
    void givenADuplicateName_whenCreatingARuleSet_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        mockMvc.perform(post("/api/admin/rule-sets")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"name": "Taken name"}
                        """)
                .with(csrf()));

        // when
        ResultActions result = mockMvc.perform(post("/api/admin/rule-sets")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"name": "Taken name"}
                        """)
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.CONFLICT, "urn:courtside:error:rule-set-name-taken");
    }

    @Test
    void givenAnUnsupportedContentType_whenPosting_thenTheResponseCarriesItsOwnTypeAndNoCallerInput()
            throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(post("/api/admin/booking-cards")
                .contentType(MediaType.TEXT_PLAIN)
                .content("nope")
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.UNSUPPORTED_MEDIA_TYPE, "urn:courtside:error:unsupported-media-type");
        assertThat(result.andReturn().getResponse().getContentAsString()).doesNotContain("text/plain");
        // Exactly what the document says the endpoint consumes.
        assertThat(headerValues(result, "Accept"))
                .containsExactly("application/json");
    }

    @Test
    void givenAnUnacceptableRepresentation_whenRequesting_thenTheResponseCarriesItsOwnType() throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(get("/api/admin/config").accept(MediaType.APPLICATION_XML));

        // then
        assertProblem(result, HttpStatus.NOT_ACCEPTABLE, "urn:courtside:error:not-acceptable");
    }

    @Test
    void givenAMissingRequiredParameter_whenRequesting_thenTheResponseNamesItInParams() throws Exception {
        // given / when
        ResultActions result = mockMvc.perform(get("/api/bookings"));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:missing-parameter");
        result.andExpect(jsonPath("$.violations[0].code").value("request.missingParameter"))
                .andExpect(jsonPath("$.violations[0].params.parameter").value("date"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABookingOutsideOpeningHours_whenCreatingIt_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        createAccount("doe.jane", Role.MEMBER);

        // when
        ResultActions result = mockMvc.perform(bookingPost()
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {
                          "courtIds": ["%s"],
                          "cardId": "%s",
                          "startsAt": "2026-05-12T06:10:00+02:00",
                          "endsAt": "2026-05-12T06:50:00+02:00",
                          "participants": [{"guestName": "Partner"}]
                        }
                        """.formatted(courtId, MEMBER_BOOKING_CARD))
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.UNPROCESSABLE_ENTITY, "urn:courtside:error:booking-rules-violated");
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAMemberCardBookedAlone_whenCreatingABooking_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        createAccount("doe.jane", Role.MEMBER);

        // when
        ResultActions result = mockMvc.perform(bookingPost()
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {
                          "courtIds": ["%s"],
                          "cardId": "%s",
                          "startsAt": "2026-05-12T18:00:00+02:00",
                          "endsAt": "2026-05-12T19:00:00+02:00",
                          "participants": []
                        }
                        """.formatted(courtId, MEMBER_BOOKING_CARD))
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:participants-invalid");
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnOccupiedSlot_whenBookingItAgain_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        createAccount("doe.jane", Role.MEMBER);
        String body = """
                {
                  "courtIds": ["%s"],
                  "cardId": "%s",
                  "startsAt": "2026-05-12T18:00:00+02:00",
                  "endsAt": "2026-05-12T19:00:00+02:00",
                  "participants": [{"guestName": "Partner"}]
                }
                """.formatted(courtId, MEMBER_BOOKING_CARD);
        mockMvc.perform(bookingPost().contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()))
                .andExpect(status().isCreated());

        // when
        ResultActions result = mockMvc.perform(
                bookingPost().contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()));

        // then
        assertProblem(result, HttpStatus.CONFLICT, "urn:courtside:error:court-unavailable");
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenACardRequiringATrainer_whenAMemberBooksIt_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        createAccount("doe.jane", Role.MEMBER);

        // when
        ResultActions result = mockMvc.perform(bookingPost()
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {
                          "courtIds": ["%s"],
                          "cardId": "%s",
                          "startsAt": "2026-05-12T18:00:00+02:00",
                          "endsAt": "2026-05-12T19:00:00+02:00"
                        }
                        """.formatted(courtId, TRAINING_CARD))
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.FORBIDDEN, "urn:courtside:error:card-role-required");
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnUnknownBooking_whenCancellingIt_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        createAccount("doe.jane", Role.MEMBER);

        // when
        ResultActions result = mockMvc.perform(delete("/api/bookings/" + UUID.randomUUID()).with(csrf()));

        // then
        assertProblem(result, HttpStatus.NOT_FOUND, "urn:courtside:error:booking-not-found");
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAnUnknownSeries_whenCancellingIt_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        createAccount("roe.john", Role.TRAINER);

        // when
        ResultActions result = mockMvc.perform(delete("/api/booking-series/" + UUID.randomUUID())
                .param("fromBookingId", UUID.randomUUID().toString())
                .param("scope", "WHOLE_SERIES")
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.NOT_FOUND, "urn:courtside:error:series-not-found");
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "TRAINER")
    void givenAMoveBlockedByAnotherBooking_whenMovingTheSeries_thenTheResponseCarriesItsOwnType()
            throws Exception {
        // given
        createAccount("roe.john", Role.TRAINER);
        String created = mockMvc.perform(post("/api/booking-series")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "%s",
                                  "startsOn": "2026-06-02",
                                  "startTime": "18:00:00",
                                  "durationMinutes": 120,
                                  "intervalWeeks": 1,
                                  "weekdays": ["TUESDAY"],
                                  "occurrenceCount": 2,
                                  "confirmedStarts": [
                                    "2026-06-02T18:00:00+02:00",
                                    "2026-06-09T18:00:00+02:00"
                                  ]
                                }
                                """.formatted(courtId, TRAINING_CARD))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID seriesId = UUID.fromString(JsonPath.read(created, "$.seriesId"));
        UUID firstBookingId = UUID.fromString(JsonPath.<List<String>>read(created, "$.bookingIds").getFirst());

        mockMvc.perform(bookingPost()
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "%s",
                                  "startsAt": "2026-06-09T20:00:00+02:00",
                                  "endsAt": "2026-06-09T22:00:00+02:00"
                                }
                                """.formatted(courtId, TRAINING_CARD))
                        .with(csrf()))
                .andExpect(status().isCreated());

        // when
        ResultActions result = mockMvc.perform(post("/api/booking-series/{id}/move", seriesId)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {
                          "fromBookingId": "%s",
                          "scope": "WHOLE_SERIES",
                          "newStartTime": "20:00:00"
                        }
                        """.formatted(firstBookingId))
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.CONFLICT, "urn:courtside:error:series-move-conflict");
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAnUnknownBookingCard_whenCreatingABooking_thenTheResponseCarriesItsOwnType() throws Exception {
        // given
        createAccount("doe.jane", Role.MEMBER);

        // when
        ResultActions result = mockMvc.perform(bookingPost()
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {
                          "courtIds": ["%s"],
                          "cardId": "%s",
                          "startsAt": "2026-05-12T18:00:00+02:00",
                          "endsAt": "2026-05-12T19:00:00+02:00",
                          "participants": [{"guestName": "Partner"}]
                        }
                        """.formatted(courtId, UUID.randomUUID()))
                .with(csrf()));

        // then
        assertProblem(result, HttpStatus.BAD_REQUEST, "urn:courtside:error:card-not-bookable");
    }

    private void createAccount(String username, Role role) {
        String[] name = username.split("\\.");
        UUID person = identity.createPerson(capitalize(name[1]), capitalize(name[0]), username + "@example.org");
        identity.createAccount(person, username, Set.of(role));
    }

    private MockHttpServletRequestBuilder bookingPost() {
        return post("/api/bookings").header("Idempotency-Key", UUID.randomUUID().toString());
    }

    private static String capitalize(String value) {
        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private void assertProblem(ResultActions result, HttpStatus expectedStatus, String expectedType)
            throws Exception {
        result.andExpect(status().is(expectedStatus.value()))
                .andExpect(jsonPath("$.type").value(expectedType));
        String type = JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.type");
        assertThat(type).matches(ALLOWED_TYPE);
    }

    private List<String> headerValues(ResultActions result, String name) throws Exception {
        String value = result.andReturn().getResponse().getHeader(name);
        assertThat(value).as("%s header", name).isNotBlank();
        return Arrays.stream(value.split(",\\s*")).toList();
    }
}
