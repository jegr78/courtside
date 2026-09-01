package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

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
                .andExpect(jsonPath("$.courts[0].courtName").value(org.hamcrest.Matchers.nullValue()))
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
