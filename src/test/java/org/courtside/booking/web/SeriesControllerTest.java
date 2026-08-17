package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.series.BookingSeriesRepository;
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
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.courtside.member.MemberFixtures.memberSince;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = "courtside.test.clock=2026-04-01T10:00:00Z")
class SeriesControllerTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_MEMBERSHIP =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    @Autowired
    private BookingSeriesRepository series;

    private UUID courtId;
    private UUID trainerPersonId;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        courtId = courts.save(new Court(1, "Court 1")).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        Person trainer = persons.save(new Person("John", "Roe", "john@example.org"));
        trainerPersonId = trainer.getId();
        accounts.save(new UserAccount(trainer, "trainer.john", "irrelevant", Set.of(Role.TRAINER)));
        Person member = persons.save(new Person("Jane", "Doe", "jane@example.org"));
        accounts.save(new UserAccount(member, "doe.jane", "irrelevant", Set.of(Role.MEMBER)));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void whenPreviewingAWeeklySeries_thenEveryOccurrenceIsListed() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(previewJson(4))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.occurrences.length()").value(4))
                .andExpect(jsonPath("$.creatableCount").value(4))
                .andExpect(jsonPath("$.occurrences[0].blockedCourtIds").isEmpty())
                .andExpect(jsonPath("$.truncatedByHorizon").value(false));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenACountLargerThanTheHorizonAllows_whenPreviewing_thenTheResponseSaysSo() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(previewJson(100))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.occurrences.length()").value(53))
                .andExpect(jsonPath("$.truncatedByHorizon").value(true))
                .andExpect(jsonPath("$.horizonLimit").value("2027-04-07"));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenEveryOccurrenceRunsPastClosingTime_whenPreviewing_thenTheViolationsCarryCodeAndParams()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(pastClosingTimePreviewJson())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.creatableCount").value(0))
                .andExpect(jsonPath("$.occurrences[0].creatable").value(false))
                .andExpect(jsonPath("$.occurrences[0].violations.length()").value(1))
                .andExpect(jsonPath("$.occurrences[0].violations[0].code")
                        .value("booking.rule.openingHours.outside"))
                .andExpect(jsonPath("$.occurrences[0].violations[0].params.opensAt").value("08:00"))
                .andExpect(jsonPath("$.occurrences[0].violations[0].params.closesAt").value("22:00"));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenATargetPastClosingTime_whenPreviewingTheMove_thenTheViolationsCarryCodeAndParams()
            throws Exception {
        // given
        String created = createSeriesAs("trainer.john");
        UUID seriesId = UUID.fromString(JsonPath.read(created, "$.seriesId"));
        UUID firstBookingId = UUID.fromString(JsonPath.<List<String>>read(created, "$.bookingIds").getFirst());

        // when / then
        mockMvc.perform(post("/api/booking-series/{id}/move/preview", seriesId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(moveJson(firstBookingId, "21:00:00"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.executable").value(false))
                .andExpect(jsonPath("$.moves[0].executable").value(false))
                .andExpect(jsonPath("$.moves[0].violations.length()").value(1))
                .andExpect(jsonPath("$.moves[0].violations[0].code")
                        .value("booking.rule.openingHours.outside"))
                .andExpect(jsonPath("$.moves[0].violations[0].params.closesAt").value("22:00"));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void whenCreatingASeriesFromConfirmedOccurrences_thenItIsCreated() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson())
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.bookingIds.length()").value(2))
                .andExpect(jsonPath("$.skipped").isEmpty());
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenEveryConfirmedOccurrenceIsInThePast_whenCreating_thenNoSeriesIsCreated() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(pastSeriesJson())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.seriesId").doesNotExist())
                .andExpect(jsonPath("$.bookingIds").isEmpty())
                .andExpect(jsonPath("$.skipped.length()").value(2));
        assertThat(series.count()).isZero();
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenTheTrainerIsAlsoAMember_whenPreviewing_thenTheAdvanceWindowNarrowsTheCreatableCount()
            throws Exception {
        // given
        members.save(memberSince(trainerPersonId, ACTIVE_MEMBERSHIP));

        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(fridayPreviewJson(6))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.occurrences.length()").value(6))
                .andExpect(jsonPath("$.creatableCount").value(1));
    }

    @Test
    @WithMockUser(username = "no.account", roles = "MEMBER")
    void givenAnAuthenticatedPrincipalWithoutAnAccountRow_whenPreviewing_thenItIsStillAllowed()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(previewJson(4))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.creatableCount").value(4));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAMemberAndATrainerCard_whenPreviewing_thenItIsStillAllowed() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(previewJson(4))
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenAConfirmedSeries_whenCancellingTheWholeSeries_thenNoContent() throws Exception {
        // given
        String created = createSeriesAs("trainer.john");
        UUID seriesId = UUID.fromString(JsonPath.read(created, "$.seriesId"));
        UUID firstBookingId = UUID.fromString(JsonPath.<List<String>>read(created, "$.bookingIds").getFirst());

        // when / then
        mockMvc.perform(delete("/api/booking-series/{id}", seriesId)
                        .param("fromBookingId", firstBookingId.toString())
                        .param("scope", "WHOLE_SERIES")
                        .with(csrf()))
                .andExpect(status().isNoContent());
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenAnOwnedSeries_whenMovingTheWholeSeries_thenEveryOccurrenceMoves() throws Exception {
        // given
        String created = createSeriesAs("trainer.john");
        UUID seriesId = UUID.fromString(JsonPath.read(created, "$.seriesId"));
        UUID firstBookingId = UUID.fromString(JsonPath.<List<String>>read(created, "$.bookingIds").getFirst());

        // when / then
        mockMvc.perform(post("/api/booking-series/{id}/move", seriesId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(moveJson(firstBookingId))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.moved").value(2));
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenTheSameCourtTwice_whenMovingOrPreviewingTheMove_thenBothAnswerBadRequest()
            throws Exception {
        // given
        String created = createSeriesAs("trainer.john");
        UUID seriesId = UUID.fromString(JsonPath.read(created, "$.seriesId"));
        UUID firstBookingId = UUID.fromString(JsonPath.<List<String>>read(created, "$.bookingIds").getFirst());
        String body = duplicateCourtMoveJson(firstBookingId);

        // when / then
        mockMvc.perform(post("/api/booking-series/{id}/move/preview", seriesId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("newCourtIds"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NoDuplicates"));

        mockMvc.perform(post("/api/booking-series/{id}/move", seriesId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("newCourtIds"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NoDuplicates"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenASeriesOwnedBySomeoneElse_whenAMemberTriesToMoveIt_thenForbidden() throws Exception {
        // given
        String created = createSeriesAs("trainer.john");
        UUID seriesId = UUID.fromString(JsonPath.read(created, "$.seriesId"));
        UUID firstBookingId = UUID.fromString(JsonPath.<List<String>>read(created, "$.bookingIds").getFirst());

        // when / then
        mockMvc.perform(post("/api/booking-series/{id}/move", seriesId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(moveJson(firstBookingId))
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.title").value("Not allowed"))
                .andExpect(jsonPath("$.detail").value(
                        "You may only change bookings you own or are authorized to manage"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:booking-not-owned"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenASeriesOwnedBySomeoneElse_whenAMemberPreviewsAMoveOfIt_thenForbidden() throws Exception {
        // given
        String created = createSeriesAs("trainer.john");
        UUID seriesId = UUID.fromString(JsonPath.read(created, "$.seriesId"));
        UUID firstBookingId = UUID.fromString(JsonPath.<List<String>>read(created, "$.bookingIds").getFirst());

        // when / then
        mockMvc.perform(post("/api/booking-series/{id}/move/preview", seriesId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(moveJson(firstBookingId))
                        .with(csrf()))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenEveryConfirmedOccurrenceIsImpossible_whenCreating_thenOkWithoutALocation() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "22222222-2222-2222-2222-222222222222",
                                  "startsOn": "2026-04-07",
                                  "startTime": "21:00:00",
                                  "durationMinutes": 120,
                                  "intervalWeeks": 1,
                                  "weekdays": ["TUESDAY"],
                                  "occurrenceCount": 2,
                                  "confirmedStarts": [
                                    "2026-04-07T21:00:00+02:00",
                                    "2026-04-14T21:00:00+02:00"
                                  ]
                                }
                                """.formatted(courtId))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Location"))
                .andExpect(jsonPath("$.seriesId").doesNotExist())
                .andExpect(jsonPath("$.bookingIds").isEmpty())
                .andExpect(jsonPath("$.skipped.length()").value(2));

        assertThat(series.count()).isZero();
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenADurationLongerThanADay_whenPreviewing_thenBadRequest() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "22222222-2222-2222-2222-222222222222",
                                  "startsOn": "2026-04-07",
                                  "startTime": "18:00:00",
                                  "durationMinutes": 65656,
                                  "intervalWeeks": 1,
                                  "weekdays": ["TUESDAY"],
                                  "occurrenceCount": 2
                                }
                                """.formatted(courtId))
                        .with(csrf()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenMoreOccurrencesThanAllowed_whenPreviewing_thenBadRequest() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(previewJson(32768))
                        .with(csrf()))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithMockUser(username = "trainer.john", roles = "TRAINER")
    void givenNoConfirmedStarts_whenCreating_thenBadRequest() throws Exception {
        // when / then
        mockMvc.perform(post("/api/booking-series")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "courtIds": ["%s"],
                                  "cardId": "22222222-2222-2222-2222-222222222222",
                                  "startsOn": "2026-04-07",
                                  "startTime": "18:00:00",
                                  "durationMinutes": 120,
                                  "intervalWeeks": 1,
                                  "weekdays": ["TUESDAY"],
                                  "occurrenceCount": 2
                                }
                                """.formatted(courtId))
                        .with(csrf()))
                .andExpect(status().isBadRequest());
    }

    private String createSeriesAs(String username) throws Exception {
        return mockMvc.perform(post("/api/booking-series")
                        .with(user(username).roles("TRAINER"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson())
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    private String moveJson(UUID fromBookingId) {
        return moveJson(fromBookingId, "19:00:00");
    }

    private String moveJson(UUID fromBookingId, String newStartTime) {
        return """
                {
                  "fromBookingId": "%s",
                  "scope": "WHOLE_SERIES",
                  "newStartTime": "%s"
                }
                """.formatted(fromBookingId, newStartTime);
    }

    private String pastClosingTimePreviewJson() {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "22222222-2222-2222-2222-222222222222",
                  "startsOn": "2026-04-07",
                  "startTime": "21:00:00",
                  "durationMinutes": 120,
                  "intervalWeeks": 1,
                  "weekdays": ["TUESDAY"],
                  "occurrenceCount": 2
                }
                """.formatted(courtId);
    }

    private String duplicateCourtMoveJson(UUID fromBookingId) {
        return """
                {
                  "fromBookingId": "%s",
                  "scope": "WHOLE_SERIES",
                  "newCourtIds": ["%s", "%s"]
                }
                """.formatted(fromBookingId, courtId, courtId);
    }

    private String createJson() {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "22222222-2222-2222-2222-222222222222",
                  "startsOn": "2026-04-07",
                  "startTime": "18:00:00",
                  "durationMinutes": 120,
                  "intervalWeeks": 1,
                  "weekdays": ["TUESDAY"],
                  "occurrenceCount": 2,
                  "note": "Team training",
                  "confirmedStarts": [
                    "2026-04-07T18:00:00+02:00",
                    "2026-04-14T18:00:00+02:00"
                  ]
                }
                """.formatted(courtId);
    }

    private String fridayPreviewJson(int occurrenceCount) {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "22222222-2222-2222-2222-222222222222",
                  "startsOn": "2026-04-03",
                  "startTime": "18:00:00",
                  "durationMinutes": 120,
                  "intervalWeeks": 1,
                  "weekdays": ["FRIDAY"],
                  "occurrenceCount": %d
                }
                """.formatted(courtId, occurrenceCount);
    }

    private String pastSeriesJson() {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "22222222-2222-2222-2222-222222222222",
                  "startsOn": "2026-03-03",
                  "startTime": "18:00:00",
                  "durationMinutes": 120,
                  "intervalWeeks": 1,
                  "weekdays": ["TUESDAY"],
                  "occurrenceCount": 2,
                  "confirmedStarts": [
                    "2026-03-03T18:00:00+01:00",
                    "2026-03-10T18:00:00+01:00"
                  ]
                }
                """.formatted(courtId);
    }

    private String previewJson(int occurrenceCount) {
        return """
                {
                  "courtIds": ["%s"],
                  "cardId": "22222222-2222-2222-2222-222222222222",
                  "startsOn": "2026-04-07",
                  "startTime": "18:00:00",
                  "durationMinutes": 120,
                  "intervalWeeks": 1,
                  "weekdays": ["TUESDAY"],
                  "occurrenceCount": %d
                }
                """.formatted(courtId, occurrenceCount);
    }
}
