package org.courtside.facility.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.FacilityService;
import org.courtside.facility.OpeningPeriod;
import org.courtside.facility.internal.CourtRepository;
import org.courtside.facility.internal.WeeklyOpeningHours;
import org.courtside.facility.Court;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "jane.doe", roles = "MEMBER")
class OpeningHoursControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityService facility;

    @Autowired
    private CourtRepository courts;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAnAnonymousCaller_whenListingPublicly_thenItSucceeds() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/opening-hours").with(anonymous()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(7));
    }

    @Test
    void givenAnAnonymousCaller_whenLoadingTheBookingGrid_thenItsClockAndWindowsAreReturned()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/booking-grid").with(anonymous()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.timeZone").value("Europe/Berlin"))
                .andExpect(jsonPath("$.slotMinutes").value(30))
                .andExpect(jsonPath("$.openingHours.length()").value(7))
                .andExpect(jsonPath("$.openingWeeks.length()").value(1))
                .andExpect(jsonPath("$.openingWeeks[0].effectiveFrom").value(nullValue()))
                .andExpect(jsonPath("$.openingWeeks[0].days.length()").value(7));
    }

    @Test
    void whenListingPublicly_thenEveryWeekdayIsPresentEvenWhenClosed() throws Exception {
        // given
        facility.setOpeningHours(
                DayOfWeek.MONDAY, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));

        // when / then
        mockMvc.perform(get("/api/public/opening-hours"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(7))
                .andExpect(jsonPath("$[0].dayOfWeek").value("MONDAY"))
                .andExpect(jsonPath("$[0].opensAt").value("08:00:00"))
                .andExpect(jsonPath("$[0].closesAt").value("22:00:00"))
                .andExpect(jsonPath("$[6].dayOfWeek").value("SUNDAY"))
                .andExpect(jsonPath("$[6].opensAt").doesNotExist());
    }

    @Test
    void givenEntriesBeforeInsideAndAfterAWeek_whenLoadingTheGridForThatWeek_thenOnlyTheOverlappingOnesAreReturned()
            throws Exception {
        // given
        UUID court = courts.save(new Court(4, null)).getId();
        facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Before",
                LocalDate.of(2026, 6, 1), LocalDate.of(2026, 7, 5), closedWeek());
        OpeningPeriod inside = facility.createOpeningPeriod(OpeningPeriod.Kind.SEASON, "Inside",
                LocalDate.of(2026, 7, 12), LocalDate.of(2026, 7, 20), closedWeek());
        facility.createOpeningPeriod(OpeningPeriod.Kind.HOLIDAY, "After",
                LocalDate.of(2026, 7, 13), LocalDate.of(2026, 7, 13), closedWeek());
        facility.createCourtClosure(court, "Before", LocalDate.of(2026, 6, 1), LocalDate.of(2026, 7, 5));
        UUID closure = facility.createCourtClosure(court, "Inside", LocalDate.of(2026, 7, 6), LocalDate.of(2026, 7, 6)).id();
        facility.createCourtClosure(court, "After", LocalDate.of(2026, 7, 13), LocalDate.of(2026, 7, 14));

        // when / then
        mockMvc.perform(get("/api/public/booking-grid").param("from", "2026-07-06").param("to", "2026-07-12")
                        .with(anonymous()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openingPeriods.length()").value(1))
                .andExpect(jsonPath("$.openingPeriods[0].id").value(inside.id().toString()))
                .andExpect(jsonPath("$.courtClosures.length()").value(1))
                .andExpect(jsonPath("$.courtClosures[0].id").value(closure.toString()));
    }

    @Test
    void givenEntriesTodayAndLater_whenLoadingTheGridWithoutARange_thenOnlyTodaysAreReturned() throws Exception {
        // given
        OpeningPeriod today = facility.createOpeningPeriod(OpeningPeriod.Kind.HOLIDAY, "Today",
                LocalDate.of(2026, 5, 12), LocalDate.of(2026, 5, 12), closedWeek());
        facility.createOpeningPeriod(OpeningPeriod.Kind.HOLIDAY, "Later",
                LocalDate.of(2026, 5, 13), LocalDate.of(2026, 5, 13), closedWeek());

        // when / then
        mockMvc.perform(get("/api/public/booking-grid").with(anonymous()))
                .andExpect(jsonPath("$.openingPeriods.length()").value(1))
                .andExpect(jsonPath("$.openingPeriods[0].id").value(today.id().toString()));
    }

    private static List<WeeklyOpeningHours> closedWeek() {
        return Arrays.stream(DayOfWeek.values()).map(day -> new WeeklyOpeningHours(day, null, null)).toList();
    }
}
