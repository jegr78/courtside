package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.testfixture.BookingTestFixture;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({BookingTestFixture.class, FacilityTestFixture.class, IdentityTestFixture.class})
class AttendanceControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_CARD = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-05-12T10:00:00Z");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private BookingTestFixture bookings;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    private MockMvc mockMvc;
    private UUID court;
    private UUID memberPerson;
    private UUID member;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        court = facility.createCourt(1, "Court 1");
        memberPerson = identity.createPerson("Jane", "Doe", "jane@example.org");
        member = identity.createEnabledAccount(memberPerson, "doe.jane", Set.of(Role.MEMBER));
        identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary@example.org"), "major.mary",
                Set.of(Role.ADMIN));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenTheDefaultPolicy_whenTheBoardSwitchesAttendanceOnWithAReleaseTime_thenThePolicyIsStored() throws Exception {
        // given
        mockMvc.perform(get("/api/admin/attendance-policy"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.releaseAfterMinutes").doesNotExist());

        // when
        mockMvc.perform(put("/api/admin/attendance-policy").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\": true, \"releaseAfterMinutes\": 15}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.releaseAfterMinutes").value(15));

        // then
        mockMvc.perform(get("/api/admin/attendance-policy"))
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.releaseAfterMinutes").value(15));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void whenTheBoardSetsAReleaseTimeWithoutAttendance_thenThePolicyIsRefusedWithItsCode() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/attendance-policy").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\": false, \"releaseAfterMinutes\": 15}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:attendance-policy-invalid"))
                .andExpect(jsonPath("$.violations[0].code").value("attendance.policy.releaseNeedsAttendance"));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void whenTheBoardSetsAReleaseTimeBeyondTwoHours_thenTheFieldIsRefused() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/attendance-policy").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\": true, \"releaseAfterMinutes\": 121}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("releaseAfterMinutes"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Max"));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenAStartedBooking_whenTheBoardRecordsANoShow_thenTheAppointmentAndThePersonShowIt() throws Exception {
        // given
        bookings.trackAttendance(null);
        UUID booking = startedMinutesAgo(90);

        // when
        mockMvc.perform(put("/api/admin/bookings/{id}/attendance", booking).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"outcome\": \"NO_SHOW\"}"))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/managed/bookings/{id}", booking))
                .andExpect(jsonPath("$.attendance").value("NO_SHOW"));
        mockMvc.perform(get("/api/admin/roster/{personId}/no-shows", memberPerson))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].bookingId").value(booking.toString()));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenACountingNoShow_whenTheBoardLiftsIt_thenTheCountIsReturnedAndTheListIsEmpty() throws Exception {
        // given
        bookings.trackAttendance(null);
        UUID booking = startedMinutesAgo(90);
        mockMvc.perform(put("/api/admin/bookings/{id}/attendance", booking).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content("{\"outcome\": \"NO_SHOW\"}"));

        // when
        mockMvc.perform(post("/api/admin/roster/{personId}/no-shows/lift", memberPerson).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lifted").value(1));

        // then
        mockMvc.perform(get("/api/admin/roster/{personId}/no-shows", memberPerson))
                .andExpect(jsonPath("$", hasSize(0)));
        mockMvc.perform(get("/api/managed/bookings/{id}", booking))
                .andExpect(jsonPath("$.attendance").value("NO_SHOW"));
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenARecordedNoShow_whenTheBoardClearsIt_thenTheAppointmentCarriesNoAttendance() throws Exception {
        // given
        bookings.trackAttendance(null);
        UUID booking = startedMinutesAgo(90);
        mockMvc.perform(put("/api/admin/bookings/{id}/attendance", booking).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content("{\"outcome\": \"NO_SHOW\"}"));

        // when
        mockMvc.perform(delete("/api/admin/bookings/{id}/attendance", booking).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/managed/bookings/{id}", booking))
                .andExpect(jsonPath("$.attendance").doesNotExist());
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenTheClubRecordsNoAttendance_whenTheBoardRecordsANoShow_thenTheConflictNamesItsType() throws Exception {
        // given
        UUID booking = startedMinutesAgo(90);

        // when / then
        mockMvc.perform(put("/api/admin/bookings/{id}/attendance", booking).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"outcome\": \"NO_SHOW\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:attendance-not-tracked"))
                .andExpect(jsonPath("$.violations[0].code").value("attendance.notTracked"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenTheCheckInWindowIsOpen_whenTheMemberChecksIn_thenTheirBookingShowsItAsCheckedIn() throws Exception {
        // given
        bookings.trackAttendance(null);
        UUID booking = startedMinutesAgo(-10);

        // when
        mockMvc.perform(post("/api/my/bookings/{id}/check-in", booking).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].id").value(booking.toString()))
                .andExpect(jsonPath("$.items[0].checkIn.checkedIn").value(true))
                .andExpect(jsonPath("$.items[0].checkIn.opensAt").value("2026-05-12T09:55:00Z"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABookingAnHourAhead_whenTheMemberChecksIn_thenTheConflictSaysTheWindowIsClosed() throws Exception {
        // given
        bookings.trackAttendance(null);
        UUID booking = startedMinutesAgo(-60);

        // when / then
        mockMvc.perform(post("/api/my/bookings/{id}/check-in", booking).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:check-in-closed"))
                .andExpect(jsonPath("$.violations[0].code").value("attendance.checkIn.closed"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenTheClubRecordsNoAttendance_whenTheMemberListsBookings_thenNoneOffersACheckIn() throws Exception {
        // given
        UUID booking = startedMinutesAgo(-10);

        // when / then
        mockMvc.perform(get("/api/my/bookings"))
                .andExpect(jsonPath("$.items[0].id").value(booking.toString()))
                .andExpect(jsonPath("$.items[0].checkIn").doesNotExist());
    }

    private UUID startedMinutesAgo(int minutes) {
        Instant start = NOW.minus(minutes, ChronoUnit.MINUTES);
        return bookings.insertBookingThatHasStarted(court, MEMBER_CARD,
                new TimeSlot(start, start.plus(1, ChronoUnit.HOURS)), member);
    }
}
