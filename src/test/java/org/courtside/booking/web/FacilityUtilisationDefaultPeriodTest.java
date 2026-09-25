package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
@TestPropertySource(properties = "courtside.test.clock=2026-05-31T22:30:00Z")
class FacilityUtilisationDefaultPeriodTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenJuneHasBegunInTheClubZoneButNotInUtc_whenReportingWithoutAPeriod_thenMayIsReported()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/reports/facility-utilisation"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value("2026-05-01"))
                .andExpect(jsonPath("$.to").value("2026-05-31"))
                .andExpect(jsonPath("$.timeZone").value("Europe/Berlin"));
    }
}
