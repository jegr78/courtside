package org.courtside.shared.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.TestApplicationBuild;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.file.Path;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;

class SpaConfigurationTest extends AbstractIntegrationTest {

    private static final Path BUILD = TestApplicationBuild.create();

    private static final String SHELL = "built /index.html";

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void serveTheBuild(DynamicPropertyRegistry registry) {
        registry.add(TestApplicationBuild.STATIC_LOCATIONS, () -> BUILD.toUri().toString());
    }

    @AfterAll
    static void removeTheBuild() {
        TestApplicationBuild.delete(BUILD);
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAnAnonymousVisitor_whenOpeningAClientRoute_thenTheAppShellIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/login"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/html"))
                .andExpect(content().string(SHELL))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Referrer-Policy", "strict-origin-when-cross-origin"))
                .andExpect(header().doesNotExist("Strict-Transport-Security"))
                .andExpect(header().string("Content-Security-Policy",
                        allOf(containsString("default-src 'self'"),
                                containsString("img-src 'self' https:"),
                                containsString("base-uri 'none'"),
                                not(containsString("base-uri 'self'")),
                                not(containsString("http:")),
                                not(containsString("data:")))));
    }

    @Test
    void givenASecureRequest_whenOpeningAClientRoute_thenTheAppSetsHsts() throws Exception {
        // when / then
        mockMvc.perform(get("/login").secure(true))
                .andExpect(status().isOk())
                .andExpect(header().string("Strict-Transport-Security", containsString("max-age=")));
    }

    @Test
    void givenAnAnonymousVisitor_whenOpeningTheCourtPlanRoute_thenTheAppShellIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/courts"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/html"))
                .andExpect(content().string(SHELL));
    }

    @Test
    void givenAnAnonymousVisitor_whenOpeningPersonalBookings_thenTheLoginCapableAppShellIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/my-bookings"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/html"))
                .andExpect(content().string(SHELL));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/account", "/account/security"})
    void givenAnAnonymousVisitor_whenOpeningTheAccountArea_thenTheLoginCapableAppShellIsServed(String path)
            throws Exception {
        // when / then
        mockMvc.perform(get(path))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/html"))
                .andExpect(content().string(SHELL));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/admin", "/admin/setup", "/admin/configuration", "/admin/deadlines",
            "/admin/rule-sets", "/admin/facility",
            "/admin/facility/courts", "/admin/facility/access-points", "/admin/facility/opening-hours",
            "/admin/facility/booking-cards",
            "/admin/facility/booking-cards/card-1",
            "/admin/facility/slot-fillers", "/admin/roster", "/admin/audit"})
    void givenAnAnonymousVisitor_whenOpeningAnAdministrationRoute_thenTheLoginCapableAppShellIsServed(String route)
            throws Exception {
        // when / then
        mockMvc.perform(get(route))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/html"))
                .andExpect(content().string(SHELL));
    }
}
