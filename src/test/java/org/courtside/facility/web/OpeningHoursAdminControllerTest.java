package org.courtside.facility.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.Booking;
import org.courtside.booking.BookingRepository;
import org.courtside.booking.BookingService;
import org.courtside.booking.BookingStatus;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.ParticipantSpec;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class OpeningHoursAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBER_BOOKING_CARD =
            UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private BookingService bookings;

    @Autowired
    private BookingRepository bookingRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenListingTheOpeningHours_thenEveryWeekdayIsPresentEvenWhenClosed() throws Exception {
        // given — the teardown clears opening_hours, so the club starts closed all week
        mockMvc.perform(put("/api/admin/opening-hours/MONDAY")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"opensAt": "08:00", "closesAt": "22:00"}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk());

        // when / then
        mockMvc.perform(get("/api/admin/opening-hours"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(7))
                .andExpect(jsonPath("$[0].dayOfWeek").value("MONDAY"))
                .andExpect(jsonPath("$[0].opensAt").value("08:00:00"))
                .andExpect(jsonPath("$[6].dayOfWeek").value("SUNDAY"))
                .andExpect(jsonPath("$[6].opensAt").doesNotExist());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAConfiguredDay_whenClosingIt_thenItIsListedWithoutHours() throws Exception {
        // given
        setHours("TUESDAY", "08:00", "22:00");

        // when
        mockMvc.perform(delete("/api/admin/opening-hours/TUESDAY").with(csrf()))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/admin/opening-hours"))
                .andExpect(jsonPath("$[1].dayOfWeek").value("TUESDAY"))
                .andExpect(jsonPath("$[1].opensAt").doesNotExist());
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenADayThatWouldCloseBeforeItOpens_whenSettingIt_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/opening-hours/WEDNESDAY")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"opensAt": "22:00", "closesAt": "08:00"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:invalid-opening-window"))
                .andExpect(jsonPath("$.code").value("openingWindow.closesBeforeItOpens"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownWeekday_whenSettingItsHours_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/opening-hours/FUNDAY")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"opensAt": "08:00", "closesAt": "22:00"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:parameter-type-mismatch"))
                .andExpect(jsonPath("$.code").value("request.parameterTypeMismatch"))
                .andExpect(jsonPath("$.params.parameter").value("day"))
                .andExpect(jsonPath("$.detail").value(not(containsString("DayOfWeek"))));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAConfiguredDay_whenSettingItAgain_thenTheExistingRowIsChangedRatherThanDuplicated()
            throws Exception {
        // given
        setHours("THURSDAY", "08:00", "22:00");

        // when
        setHours("THURSDAY", "09:00", "21:00");

        // then — opening_hours_unique_day would have rejected a second row
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
        setHours("TUESDAY", "08:00", "22:00");
        UUID courtId = courts.save(new Court(1, null)).getId();
        UUID bookerPersonId = persons.save(new Person("Jane", "Doe", "jane@example.org")).getId();
        UUID bookingId = bookings.create(new CreateBookingCommand(
                List.of(courtId), MEMBER_BOOKING_CARD,
                new TimeSlot(Instant.parse("2026-05-12T19:00:00Z"),
                        Instant.parse("2026-05-12T20:00:00Z")),
                UUID.randomUUID(), bookerPersonId, Set.of(Role.MEMBER), null,
                List.of(ParticipantSpec.guest("Partner")), null));

        // when
        setHours("TUESDAY", "08:00", "18:00");

        // then
        assertThat(bookingRepository.findById(bookingId))
                .get()
                .extracting(Booking::getStatus)
                .isEqualTo(BookingStatus.CONFIRMED);
    }

    private void setHours(String day, String opensAt, String closesAt) throws Exception {
        mockMvc.perform(put("/api/admin/opening-hours/" + day)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"opensAt": "%s", "closesAt": "%s"}
                                """.formatted(opensAt, closesAt))
                        .with(csrf()))
                .andExpect(status().isOk());
    }
}
