package org.courtside.shared.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;

class SpaConfigurationTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAnAnonymousVisitor_whenOpeningAClientRoute_thenTheAppShellIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/login"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Content-Security-Policy",
                        allOf(containsString("default-src 'self'"),
                                containsString("img-src 'self' https:"),
                                not(containsString("http:")),
                                not(containsString("data:")))));
    }

    @Test
    void givenAnAnonymousVisitor_whenOpeningTheCourtPlanRoute_thenTheAppShellIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/courts"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void givenAnAnonymousVisitor_whenOpeningPersonalBookings_thenTheLoginCapableAppShellIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/my-bookings"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/admin", "/admin/configuration", "/admin/facility",
            "/admin/facility/courts", "/admin/facility/opening-hours", "/admin/facility/booking-cards",
            "/admin/facility/slot-fillers", "/admin/roster", "/admin/audit"})
    void givenAnAnonymousVisitor_whenOpeningAnAdministrationRoute_thenTheLoginCapableAppShellIsServed(String route)
            throws Exception {
        // when / then
        mockMvc.perform(get(route))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
    }
}
