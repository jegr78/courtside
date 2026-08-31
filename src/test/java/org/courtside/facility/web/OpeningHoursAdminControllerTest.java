package org.courtside.facility.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.Court;
import org.courtside.facility.internal.CourtRepository;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({BookingTestFixture.class, IdentityTestFixture.class})
class OpeningHoursAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private BookingTestFixture bookingFixture;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAWeekWithOneOpenDay_whenSavingIt_thenEveryWeekdayComesBackAndTheClosedOnesHaveNoHours()
            throws Exception {
        // when / then
        mockMvc.perform(saveWeek(open(DayOfWeek.MONDAY, "08:00", "22:00")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(7))
                .andExpect(jsonPath("$[0].dayOfWeek").value("MONDAY"))
                .andExpect(jsonPath("$[0].opensAt").value("08:00:00"))
                .andExpect(jsonPath("$[6].dayOfWeek").value("SUNDAY"))
                .andExpect(jsonPath("$[6].opensAt").doesNotExist());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenSeveralDaysSharingAWindow_whenSavingTheWeekOnce_thenAllOfThemAreStored()
            throws Exception {
        // given
        Map<DayOfWeek, String[]> week = open(DayOfWeek.SATURDAY, "09:00", "18:00");
        week.putAll(open(DayOfWeek.SUNDAY, "09:00", "18:00"));

        // when
        mockMvc.perform(saveWeek(week)).andExpect(status().isOk());

        // then
        mockMvc.perform(get("/api/admin/opening-hours"))
                .andExpect(jsonPath("$[5].opensAt").value("09:00:00"))
                .andExpect(jsonPath("$[5].closesAt").value("18:00:00"))
                .andExpect(jsonPath("$[6].opensAt").value("09:00:00"))
                .andExpect(jsonPath("$[6].closesAt").value("18:00:00"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAConfiguredDay_whenTheWeekSendsItWithoutAWindow_thenItIsListedWithoutHours()
            throws Exception {
        // given
        mockMvc.perform(saveWeek(open(DayOfWeek.TUESDAY, "08:00", "22:00")))
                .andExpect(status().isOk());

        // when
        mockMvc.perform(saveWeek(Map.of())).andExpect(status().isOk());

        // then
        mockMvc.perform(get("/api/admin/opening-hours"))
                .andExpect(jsonPath("$[1].dayOfWeek").value("TUESDAY"))
                .andExpect(jsonPath("$[1].opensAt").doesNotExist());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenADayThatWouldCloseBeforeItOpens_whenSavingTheWeek_thenTheViolationNamesThatDay()
            throws Exception {
        // when / then
        mockMvc.perform(saveWeek(open(DayOfWeek.WEDNESDAY, "22:00", "08:00")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:weekly-opening-hours-rejected"))
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("openingWindow.closesBeforeItOpens"))
                .andExpect(jsonPath("$.violations[0].params.day").value("WEDNESDAY"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTwoUnusableDays_whenSavingTheWeek_thenBothAreReportedRatherThanTheFirst()
            throws Exception {
        // given
        Map<DayOfWeek, String[]> week = open(DayOfWeek.THURSDAY, "08:15", "20:15");
        week.putAll(open(DayOfWeek.SATURDAY, "22:00", "08:00"));

        // when / then
        mockMvc.perform(saveWeek(week))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations.length()").value(2))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("facility.openingHours.slotGridMismatch"))
                .andExpect(jsonPath("$.violations[0].params.day").value("THURSDAY"))
                .andExpect(jsonPath("$.violations[0].params.slotMinutes").value(30))
                .andExpect(jsonPath("$.violations[1].code")
                        .value("openingWindow.closesBeforeItOpens"))
                .andExpect(jsonPath("$.violations[1].params.day").value("SATURDAY"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenADayCarryingOnlyAnOpeningTime_whenSavingTheWeek_thenThatDayIsNamed() throws Exception {
        // when / then
        mockMvc.perform(saveWeek(Map.of(DayOfWeek.FRIDAY, new String[]{"08:00", null})))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("openingWindow.incomplete"))
                .andExpect(jsonPath("$.violations[0].params.day").value("FRIDAY"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAWeekNamingADayTwice_whenSavingIt_thenItIsRefusedAsIncomplete() throws Exception {
        // given
        String body = """
                {"days": [%s]}
                """.formatted(String.join(",",
                        entry("MONDAY", "08:00", "22:00"), entry("MONDAY", "08:00", "22:00"),
                        entry("WEDNESDAY", null, null), entry("THURSDAY", null, null),
                        entry("FRIDAY", null, null), entry("SATURDAY", null, null),
                        entry("SUNDAY", null, null)));

        // when / then
        mockMvc.perform(put("/api/admin/opening-hours")
                        .contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:opening-week-incomplete"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("facility.openingHours.weekIncomplete"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAWeekMissingAWeekday_whenSavingIt_thenTheContractsOwnBoundRefusesItUnstored()
            throws Exception {
        // given
        mockMvc.perform(saveWeek(open(DayOfWeek.MONDAY, "08:00", "22:00")))
                .andExpect(status().isOk());
        String body = """
                {"days": [%s]}
                """.formatted(entry("MONDAY", "09:00", "21:00"));

        // when
        mockMvc.perform(put("/api/admin/opening-hours")
                        .contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("days"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"));

        // then
        mockMvc.perform(get("/api/admin/opening-hours"))
                .andExpect(jsonPath("$[0].opensAt").value("08:00:00"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownWeekday_whenSavingTheWeek_thenItIsRejected() throws Exception {
        // given
        String body = """
                {"days": [%s]}
                """.formatted(String.join(",",
                        entry("FUNDAY", "08:00", "22:00"), entry("TUESDAY", null, null),
                        entry("WEDNESDAY", null, null), entry("THURSDAY", null, null),
                        entry("FRIDAY", null, null), entry("SATURDAY", null, null),
                        entry("SUNDAY", null, null)));

        // when / then
        mockMvc.perform(put("/api/admin/opening-hours")
                        .contentType(MediaType.APPLICATION_JSON).content(body).with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("days[0].dayOfWeek"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.TypeMismatch"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAConfiguredDay_whenTheWeekSetsItAgain_thenTheExistingRowIsChangedRatherThanDuplicated()
            throws Exception {
        // given
        mockMvc.perform(saveWeek(open(DayOfWeek.THURSDAY, "08:00", "22:00")))
                .andExpect(status().isOk());

        // when
        mockMvc.perform(saveWeek(open(DayOfWeek.THURSDAY, "09:00", "21:00")))
                .andExpect(status().isOk());

        // then
        mockMvc.perform(get("/api/admin/opening-hours"))
                .andExpect(jsonPath("$.length()").value(7))
                .andExpect(jsonPath("$[3].opensAt").value("09:00:00"))
                .andExpect(jsonPath("$[3].closesAt").value("21:00:00"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABookingInsideTheOldHours_whenTheHoursAreNarrowed_thenTheBookingStands()
            throws Exception {
        // given
        mockMvc.perform(saveWeek(open(DayOfWeek.TUESDAY, "08:00", "22:00")))
                .andExpect(status().isOk());
        UUID courtId = courts.save(new Court(1, null)).getId();
        UUID bookerPersonId = identity.createPerson("Jane", "Doe", "jane@example.org");
        UUID bookingId = bookingFixture.createBookingWithGuest(
                courtId, MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T19:00:00Z"),
                        Instant.parse("2026-05-12T20:00:00Z")),
                bookerPersonId, Set.of(Role.MEMBER), "Partner");

        // when
        mockMvc.perform(saveWeek(open(DayOfWeek.TUESDAY, "08:00", "18:00")))
                .andExpect(status().isOk());

        // then
        assertThat(bookingFixture.isConfirmed(bookingId)).isTrue();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenAddressingOneWeekday_thenNoSuchRouteAnswers() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/opening-hours/MONDAY")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"opensAt": "08:00", "closesAt": "22:00"}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound());
    }

    private static Map<DayOfWeek, String[]> open(DayOfWeek day, String opensAt, String closesAt) {
        Map<DayOfWeek, String[]> week = new LinkedHashMap<>();
        week.put(day, new String[]{opensAt, closesAt});
        return week;
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder saveWeek(
            Map<DayOfWeek, String[]> open) {
        List<String> days = new ArrayList<>();
        for (DayOfWeek day : DayOfWeek.values()) {
            String[] window = open.get(day);
            days.add(entry(day.name(), window == null ? null : window[0],
                    window == null ? null : window[1]));
        }
        return put("/api/admin/opening-hours")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"days\": [%s]}".formatted(String.join(",", days)))
                .with(csrf());
    }

    private static String entry(String day, String opensAt, String closesAt) {
        return "{\"dayOfWeek\": \"%s\", \"opensAt\": %s, \"closesAt\": %s}"
                .formatted(day, quoted(opensAt), quoted(closesAt));
    }

    private static String quoted(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }
}
