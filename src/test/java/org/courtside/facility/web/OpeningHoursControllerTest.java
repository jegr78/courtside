package org.courtside.facility.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.FacilityService;
import org.courtside.shared.OpeningWindow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.DayOfWeek;
import java.time.LocalTime;

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
                .andExpect(jsonPath("$.openingHours.length()").value(7));
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
}
