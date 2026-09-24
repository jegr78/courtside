package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@Import(FacilityTestFixture.class)
class FacilityUtilisationControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenConfirmedAndCancelledAllocations_whenReportingOneLocalDay_thenTimeIsClippedAndCourtsStayOrdered()
            throws Exception {
        // given
        UUID courtTwo = facility.createCourt(2, "Clay");
        UUID courtOne = facility.createCourt(1, null);
        facility.deactivateCourt(courtTwo);
        insertAllocation(courtOne, "2026-05-11T21:30:00Z", "2026-05-11T22:30:00Z", "CONFIRMED");
        insertAllocation(courtOne, "2026-05-12T08:00:00Z", "2026-05-12T09:00:00Z", "CONFIRMED");
        insertAllocation(courtOne, "2026-05-12T10:00:00Z", "2026-05-12T11:00:00Z", "CANCELLED");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-05-12")
                        .param("to", "2026-05-12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-05-12"))
                .andExpect(jsonPath("$.to").value("2026-05-12"))
                .andExpect(jsonPath("$.timeZone").value("Europe/Berlin"))
                .andExpect(jsonPath("$.courts.length()").value(2))
                .andExpect(jsonPath("$.courts[0].courtId").value(courtOne.toString()))
                .andExpect(jsonPath("$.courts[0].courtNumber").value(1))
                .andExpect(jsonPath("$.courts[0].courtName").value(nullValue()))
                .andExpect(jsonPath("$.courts[0].bookingCount").value(2))
                .andExpect(jsonPath("$.courts[0].occupiedMinutes").value(90))
                .andExpect(jsonPath("$.courts[1].courtId").value(courtTwo.toString()))
                .andExpect(jsonPath("$.courts[1].bookingCount").value(0))
                .andExpect(jsonPath("$.courts[1].occupiedMinutes").value(0));
    }

    @Test
    void givenTheDstSpringDay_whenReportingUtilisation_thenElapsedMinutesUseTheClubTimeZone()
            throws Exception {
        // given
        UUID court = facility.createCourt(1, "Centre");
        insertAllocation(court, "2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-03-29")
                        .param("to", "2026-03-29"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courts[0].bookingCount").value(1))
                .andExpect(jsonPath("$.courts[0].occupiedMinutes").value(1380));
    }

    @Test
    void givenACourtHeldForAQuarterOfTheOpenHours_whenReportingTheWeek_thenItsOccupancyIsAQuarter()
            throws Exception {
        // given
        openEveryDay(LocalTime.of(8, 0), LocalTime.of(12, 0));
        UUID busy = facility.createCourt(1, "Centre");
        facility.createCourt(2, "Clay");
        for (int day = 4; day <= 10; day++) {
            String date = "2026-05-%02d".formatted(day);
            insertAllocation(busy, date + "T06:00:00Z", date + "T07:00:00Z", "CONFIRMED");
        }
        insertAllocation(busy, "2026-05-06T18:00:00Z", "2026-05-06T19:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-05-04")
                        .param("to", "2026-05-10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openMinutes").value(1680))
                .andExpect(jsonPath("$.courts[0].occupiedMinutes").value(480))
                .andExpect(jsonPath("$.courts[0].occupiedOpenMinutes").value(420))
                .andExpect(jsonPath("$.courts[0].occupancy").value(closeTo(0.25, 1e-9)))
                .andExpect(jsonPath("$.courts[1].occupiedOpenMinutes").value(0))
                .andExpect(jsonPath("$.courts[1].occupancy").value(closeTo(0.0, 1e-9)));
    }

    @Test
    void givenWindowsAcrossTheSpringChange_whenReportingMarch_thenOpenMinutesAreTheElapsedOnes()
            throws Exception {
        // given
        openEveryDay(LocalTime.of(1, 0), LocalTime.of(5, 0));
        facility.createCourt(1, "Centre");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-03-01")
                        .param("to", "2026-03-31"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openMinutes").value(31 * 240 - 60));
    }

    @Test
    void givenACourtHeldForTheWholeAutumnChangeWindow_whenReportingThatDay_thenItIsFullyOccupied()
            throws Exception {
        // given
        openEveryDay(LocalTime.of(1, 0), LocalTime.of(5, 0));
        UUID court = facility.createCourt(1, "Centre");
        insertAllocation(court, "2026-10-24T23:00:00Z", "2026-10-25T04:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-10-25")
                        .param("to", "2026-10-25"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openMinutes").value(300))
                .andExpect(jsonPath("$.courts[0].occupiedOpenMinutes").value(300))
                .andExpect(jsonPath("$.courts[0].occupancy").value(closeTo(1.0, 1e-9)));
    }

    @Test
    void givenNoOpeningHours_whenReportingABookedPeriod_thenOccupancyIsNullRatherThanADivisionByZero()
            throws Exception {
        // given
        UUID court = facility.createCourt(1, "Centre");
        insertAllocation(court, "2026-05-12T08:00:00Z", "2026-05-12T09:00:00Z", "CONFIRMED");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-05-12")
                        .param("to", "2026-05-12"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openMinutes").value(0))
                .andExpect(jsonPath("$.courts[0].occupiedMinutes").value(60))
                .andExpect(jsonPath("$.courts[0].occupiedOpenMinutes").value(0))
                .andExpect(jsonPath("$.courts[0].occupancy").value(nullValue()));
    }

    @Test
    void givenNoPeriod_whenReportingUtilisation_thenTheLastFullMonthInTheClubZoneIsReported()
            throws Exception {
        // given
        facility.createCourt(1, "Centre");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-04-01"))
                .andExpect(jsonPath("$.to").value("2026-04-30"));
    }

    @Test
    void givenOnlyTheStart_whenReportingUtilisation_thenTheIncompletePeriodIsReturned()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-05-01"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:facility-utilisation-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("booking.facilityUtilisation.periodIncomplete"));
    }

    @Test
    void givenExactly366Days_whenReportingUtilisation_thenThePeriodIsAccepted()
            throws Exception {
        // given
        facility.createCourt(1, "Centre");

        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2025-01-01")
                        .param("to", "2026-01-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2025-01-01"))
                .andExpect(jsonPath("$.to").value("2026-01-01"));
    }

    @Test
    void givenTheEndPrecedesTheStart_whenReportingUtilisation_thenThePeriodViolationIsReturned()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2026-05-13")
                        .param("to", "2026-05-12"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:facility-utilisation-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("booking.facilityUtilisation.periodOrder"));
    }

    @Test
    void givenMoreThan366Days_whenReportingUtilisation_thenThePeriodLimitIsReturned()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "2025-01-01")
                        .param("to", "2026-01-02"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:facility-utilisation-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("booking.facilityUtilisation.periodTooLong"))
                .andExpect(jsonPath("$.violations[0].params.maxDays").value(366));
    }

    @Test
    void givenADateOutsideTheContractRange_whenReportingUtilisation_thenItIsRejectedBeforeConversion()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "+999999999-12-31")
                        .param("to", "+999999999-12-31"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:facility-utilisation-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("booking.facilityUtilisation.dateOutOfRange"));
    }

    @Test
    void givenTheStartIsAboveTheContractRange_whenReportingUtilisation_thenTheDateRangeIsRejected()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "+10000-01-01")
                        .param("to", "9999-12-31"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:facility-utilisation-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("booking.facilityUtilisation.dateOutOfRange"));
    }

    @Test
    void givenTheEndIsBelowTheContractRange_whenReportingUtilisation_thenTheDateRangeIsRejected()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation")
                        .param("from", "0001-01-01")
                        .param("to", "0000-12-31"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:facility-utilisation-period-invalid"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("booking.facilityUtilisation.dateOutOfRange"));
    }

    private void openEveryDay(LocalTime opensAt, LocalTime closesAt) {
        for (DayOfWeek day : DayOfWeek.values()) {
            facility.setOpeningHours(day, new OpeningWindow(opensAt, closesAt));
        }
    }

    private void insertAllocation(UUID courtId, String startsAt, String endsAt, String status) {
        UUID bookingId = UUID.randomUUID();
        jdbc.sql("INSERT INTO booking (id, card_id, status) VALUES (?, ?, ?)")
                .params(bookingId, MEMBER_BOOKING_CARD, status)
                .update();
        jdbc.sql("""
                        INSERT INTO court_allocation
                            (id, booking_id, court_id, starts_at, ends_at, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """)
                .params(UUID.randomUUID(), bookingId, courtId,
                        Instant.parse(startsAt).atOffset(ZoneOffset.UTC),
                        Instant.parse(endsAt).atOffset(ZoneOffset.UTC), status)
                .update();
    }
}
