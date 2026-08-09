package org.courtside.booking.web;

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
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Set;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Pins the answer at every throw site a request was found able to reach. Each of these once
// returned urn:courtside:error:invalid-request — a 400 carrying the exception's message verbatim,
// with no i18n code and no field, which CLAUDE.md forbids. The test was written the other way
// round first, asserting that broken answer, so that "this site is reachable" was proven rather
// than read off the annotations; those assertions were then turned into the ones below.
@WithMockUser(username = "doe.jane", roles = "MEMBER")
class InvalidRequestSurfaceTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final String VALIDATION_FAILED = "urn:courtside:error:validation-failed";

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
    private UUID secondCourtId;
    private UUID inactiveCourtId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        courtId = courts.save(new Court(1, "Court 1")).getId();
        secondCourtId = courts.save(new Court(2, "Court 2")).getId();

        Court inactive = courts.save(new Court(3, "Court 3"));
        inactive.deactivate();
        inactiveCourtId = courts.save(inactive).getId();

        Person person = persons.save(new Person("Jane", "Doe", "doe.jane@example.org"));
        UserAccount account = new UserAccount(
                person, "doe.jane", passwordEncoder.encode("secret"), Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);
    }

    @Test
    void whenBookingACourtThatDoesNotExist_thenTheAnswerCarriesACodeAndTheField() throws Exception {
        // when / then
        postBooking(booking(UUID.randomUUID().toString(), MEMBER_BOOKING_CARD.toString(),
                "2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-not-bookable"))
                .andExpect(jsonPath("$.violations[0].code").value("court.unknown"))
                .andExpect(jsonPath("$.violations[0].params.field").value("courtIds"))
                // The old shape is gone, not merely joined: a client that finds a code here would
                // keep the second render path alive.
                .andExpect(jsonPath("$.code").doesNotExist())
                .andExpect(jsonPath("$.params").doesNotExist());
    }

    @Test
    void whenBookingACourtThatIsNotActive_thenTheCodeSaysSoRatherThanUnknown() throws Exception {
        // given — a member must be able to tell "there is no such court" from "that court is
        // closed", and only the code carries that
        // when / then
        postBooking(booking(inactiveCourtId.toString(), MEMBER_BOOKING_CARD.toString(),
                "2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:court-not-bookable"))
                .andExpect(jsonPath("$.violations[0].code").value("court.inactive"));
    }

    @Test
    void whenNamingTheSameCourtTwice_thenItIsAFieldErrorOnCourtIds() throws Exception {
        // when / then
        postBooking("""
                {"courtIds": ["%s", "%s"], "cardId": "%s",
                 "startsAt": "2026-05-12T18:00:00+02:00", "endsAt": "2026-05-12T19:00:00+02:00"}
                """.formatted(courtId, courtId, MEMBER_BOOKING_CARD))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("courtIds"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NoDuplicates"));
    }

    @Test
    void whenTheBookingEndsBeforeItStarts_thenItIsAFieldErrorOnEndsAt() throws Exception {
        // when / then — the ordering is a field constraint, so TimeSlot's guard goes back to
        // being what it is meant to be: unreachable from a request
        postBooking(booking(courtId.toString(), MEMBER_BOOKING_CARD.toString(),
                "2026-05-12T19:00:00+02:00", "2026-05-12T18:00:00+02:00"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsAt"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.ChronologicalSlot"));
    }

    @Test
    void whenTheBookingEndsExactlyWhenItStarts_thenItIsAFieldErrorOnEndsAt() throws Exception {
        // given — a zero-length booking occupies nothing; the exclusion constraint would not
        // even see it as an overlap
        // when / then
        postBooking(booking(courtId.toString(), MEMBER_BOOKING_CARD.toString(),
                "2026-05-12T18:00:00+02:00", "2026-05-12T18:00:00+02:00"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsAt"));
    }

    @Test
    void whenBookingWithACardThatDoesNotExist_thenTheAnswerCarriesACodeAndTheField() throws Exception {
        // when / then
        postBooking(booking(courtId.toString(), UUID.randomUUID().toString(),
                "2026-05-12T18:00:00+02:00", "2026-05-12T19:00:00+02:00"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:card-not-bookable"))
                .andExpect(jsonPath("$.violations[0].code").value("card.unknown"))
                .andExpect(jsonPath("$.violations[0].params.field").value("cardId"));
    }

    @Test
    void whenASeriesAsksForZeroOccurrences_thenItIsAFieldErrorOnOccurrenceCount() throws Exception {
        // when / then
        postSeriesPreview(series("\"occurrenceCount\": 0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("occurrenceCount"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Min"));
    }

    @Test
    void whenASeriesEndsBeforeItStarts_thenItIsAFieldErrorOnEndsOn() throws Exception {
        // when / then
        postSeriesPreview(series("\"endsOn\": \"2026-05-01\""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsOn"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.ChronologicalSeries"));
    }

    @Test
    void whenASeriesSaysNeitherHowLongNorHowOften_thenItIsAFieldErrorOnEndsOn() throws Exception {
        // when / then
        postSeriesPreview(series(null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsOn"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.SeriesEndsOnce"));
    }

    @Test
    void whenASeriesSaysBothHowLongAndHowOften_thenItIsAFieldErrorOnEndsOn() throws Exception {
        // when / then
        postSeriesPreview(series("\"endsOn\": \"2026-09-29\", \"occurrenceCount\": 10"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsOn"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.SeriesEndsOnce"));
    }

    // Previewing and creating carry the recurrence in two different generated types, so the same
    // rule is stated twice in SeriesRequestValidator. Testing only the preview leaves the second
    // statement free to be deleted: without it a series that ends twice reaches SeriesRule's
    // constructor, and an IllegalArgumentException there is a 500 for a request the caller got
    // wrong.
    @Test
    void whenASeriesToCreateEndsBeforeItStarts_thenItIsAFieldErrorOnEndsOn() throws Exception {
        // when / then
        postSeriesCreate(seriesToCreate("\"endsOn\": \"2026-05-01\""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsOn"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.ChronologicalSeries"));
    }

    @Test
    void whenASeriesToCreateSaysNeitherHowLongNorHowOften_thenItIsAFieldErrorOnEndsOn()
            throws Exception {
        // when / then
        postSeriesCreate(seriesToCreate(null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsOn"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.SeriesEndsOnce"));
    }

    @Test
    void whenASeriesToCreateSaysBothHowLongAndHowOften_thenItIsAFieldErrorOnEndsOn()
            throws Exception {
        // when / then
        postSeriesCreate(seriesToCreate("\"endsOn\": \"2026-09-29\", \"occurrenceCount\": 10"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("endsOn"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.SeriesEndsOnce"));
    }

    // weekdays is the one array the document bounds below but not above — seven is what
    // uniqueItems already allows, not a limit worth stating. It is therefore also the only case
    // that reaches the code written for a maximum no message can name.
    @Test
    void whenASeriesNamesNoWeekdays_thenTheViolationDoesNotQuoteAnUnboundedMaximum()
            throws Exception {
        // when / then
        postSeriesPreview("""
                {"courtIds": ["%s"], "cardId": "%s", "startsOn": "2026-05-12",
                 "startTime": "18:00", "durationMinutes": 60, "intervalWeeks": 1,
                 "weekdays": [], "occurrenceCount": 4}
                """.formatted(secondCourtId, MEMBER_BOOKING_CARD))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("weekdays"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.SizeAtLeast"))
                .andExpect(jsonPath("$.fieldErrors[0].params.min").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].params.max").doesNotExist());
    }

    @Test
    void whenAMoveNamesNoCourtsAtAll_thenItIsAFieldErrorOnNewCourtIds() throws Exception {
        // given — leaving newCourtIds out means "keep the courts", so null stays legal; an empty
        // list asks for a booking on no court at all
        // when / then
        postMovePreview("""
                {"fromBookingId": "%s", "scope": "WHOLE_SERIES", "newCourtIds": []}
                """.formatted(UUID.randomUUID()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("newCourtIds"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"));
    }

    @Test
    void whenAMoveAsksForAZeroLengthBooking_thenItIsAFieldErrorOnNewDurationMinutes() throws Exception {
        // when / then
        postMovePreview("""
                {"fromBookingId": "%s", "scope": "WHOLE_SERIES", "newDurationMinutes": 0}
                """.formatted(UUID.randomUUID()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("newDurationMinutes"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Min"));
    }

    @Test
    void whenAMoveChangesNothing_thenItIsAFieldErrorRatherThanASilentNoOp() throws Exception {
        // given — all three of time, duration and courts left out; the request asks the series to
        // move to exactly where it already is
        // when / then
        postMovePreview("""
                {"fromBookingId": "%s", "scope": "WHOLE_SERIES"}
                """.formatted(UUID.randomUUID()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(VALIDATION_FAILED))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("newStartTime"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.MoveChangesSomething"));
    }

    private org.springframework.test.web.servlet.ResultActions postBooking(String body)
            throws Exception {
        return mockMvc.perform(post("/api/bookings")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));
    }

    private org.springframework.test.web.servlet.ResultActions postSeriesPreview(String body)
            throws Exception {
        return mockMvc.perform(post("/api/booking-series/preview")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));
    }

    // The series id is arbitrary: @Valid on the request body is resolved before the controller
    // method runs, so a body that fails validation never reaches the lookup.
    private org.springframework.test.web.servlet.ResultActions postMovePreview(String body)
            throws Exception {
        return mockMvc.perform(post("/api/booking-series/{id}/move/preview", UUID.randomUUID())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));
    }

    private static String booking(String courtId, String cardId, String startsAt, String endsAt) {
        return """
                {"courtIds": ["%s"], "cardId": "%s", "startsAt": "%s", "endsAt": "%s"}
                """.formatted(courtId, cardId, startsAt, endsAt);
    }

    private org.springframework.test.web.servlet.ResultActions postSeriesCreate(String body)
            throws Exception {
        return mockMvc.perform(post("/api/booking-series")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(csrf()));
    }

    // Creating additionally requires the occurrences the caller confirmed; one valid entry keeps
    // the recurrence itself the only thing under test.
    private String seriesToCreate(String ending) {
        return """
                {"courtIds": ["%s"], "cardId": "%s", "startsOn": "2026-05-12",
                 "startTime": "18:00", "durationMinutes": 60, "intervalWeeks": 1,
                 "weekdays": ["TUESDAY"], "confirmedStarts": ["2026-05-12T16:00:00Z"]%s}
                """.formatted(secondCourtId, MEMBER_BOOKING_CARD,
                ending == null ? "" : ", " + ending);
    }

    private String series(String ending) {
        return """
                {"courtIds": ["%s"], "cardId": "%s", "startsOn": "2026-05-12",
                 "startTime": "18:00", "durationMinutes": 60, "intervalWeeks": 1,
                 "weekdays": ["TUESDAY"]%s}
                """.formatted(secondCourtId, MEMBER_BOOKING_CARD,
                ending == null ? "" : ", " + ending);
    }
}
