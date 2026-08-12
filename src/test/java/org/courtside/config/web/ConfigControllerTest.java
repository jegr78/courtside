package org.courtside.config.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ConfigControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void whenReadingThePublicConfigWithoutAuthentication_thenItIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clubName").value("Courtside"))
                .andExpect(jsonPath("$.primaryColor").value("#B85C38"))
                .andExpect(jsonPath("$.defaultLocale").value("de"))
                .andExpect(jsonPath("$.slotMinutes").value(30))
                .andExpect(jsonPath("$.timeZone").value("Europe/Berlin"));
    }

    @Test
    void whenReadingTheManifestWithoutAuthentication_thenItUsesTheClubBranding() throws Exception {
        // when / then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Courtside"))
                .andExpect(jsonPath("$.short_name").value("Courtside"))
                .andExpect(jsonPath("$.theme_color").value("#B85C38"))
                .andExpect(jsonPath("$.icons[0].src").value("/icon.svg"));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAMember_whenChangingTheConfig_thenItIsForbidden() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club"))
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.title").value("Not allowed"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAdmin_whenChangingTheConfig_thenThePublicEndpointServesTheNewValues()
            throws Exception {
        // given
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club"))
                        .with(csrf()))
                .andExpect(status().isOk());

        // when / then
        mockMvc.perform(get("/api/public/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clubName").value("Example Tennis Club"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAdmin_whenChangingTheSlotDuration_thenTheBookingGridUsesTheNewValue()
            throws Exception {
        // when
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace("\"slotMinutes\": 30", "\"slotMinutes\": 15"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slotMinutes").value(15));

        // then
        mockMvc.perform(get("/api/public/booking-grid"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slotMinutes").value(15));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnAdmin_whenChangingTheTimeZone_thenTheBookingGridUsesTheNewValue()
            throws Exception {
        // when
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace(
                                "Europe/Berlin", "Pacific/Auckland"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.timeZone").value("Pacific/Auckland"));

        // then
        mockMvc.perform(get("/api/public/booking-grid"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.timeZone").value("Pacific/Auckland"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnInvalidTimeZone_whenChangingTheConfig_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace(
                                "Europe/Berlin", "Moon/Tranquility"))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("timeZone"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAFixedOffsetTimeZone_whenChangingTheConfig_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace(
                                "Europe/Berlin", "+02:00"))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("timeZone"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAFutureBookingOutsideTheNewGrid_whenChangingTheSlotDuration_thenItIsRejected()
            throws Exception {
        // given
        jdbc.sql("""
                INSERT INTO court (id, number, active)
                VALUES ('dddddddd-0000-0000-0000-000000000001', 1, true)
                """).update();
        jdbc.sql("""
                INSERT INTO booking (id, card_id, status)
                VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
                        '11111111-1111-1111-1111-111111111111', 'CONFIRMED')
                """).update();
        jdbc.sql("""
                INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
                        'aaaaaaaa-0000-0000-0000-000000000001',
                        'dddddddd-0000-0000-0000-000000000001',
                        '2026-05-12T16:30:00Z', '2026-05-12T17:00:00Z', 'CONFIRMED')
                """).update();

        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace("\"slotMinutes\": 30", "\"slotMinutes\": 60"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:slot-duration-conflict"))
                .andExpect(jsonPath("$.violations[0].code").value("config.slotMinutes.futureBookingConflict"))
                .andExpect(jsonPath("$.violations[0].params.slotMinutes").value(60));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAFutureBooking_whenChangingTheTimeZone_thenItIsRejected() throws Exception {
        // given
        jdbc.sql("""
                INSERT INTO court (id, number, active)
                VALUES ('dddddddd-0000-0000-0000-000000000001', 1, true)
                """).update();
        jdbc.sql("""
                INSERT INTO booking (id, card_id, status)
                VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
                        '11111111-1111-1111-1111-111111111111', 'CONFIRMED')
                """).update();
        jdbc.sql("""
                INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
                VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
                        'aaaaaaaa-0000-0000-0000-000000000001',
                        'dddddddd-0000-0000-0000-000000000001',
                        '2026-09-12T16:30:00Z', '2026-09-12T17:00:00Z', 'CONFIRMED')
                """).update();

        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace(
                                "Europe/Berlin", "Pacific/Auckland"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:time-zone-conflict"))
                .andExpect(jsonPath("$.violations[0].code").value(
                        "config.timeZone.futureBookingConflict"))
                .andExpect(jsonPath("$.violations[0].params.timeZone").value("Pacific/Auckland"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenOpeningHoursOutsideTheNewGrid_whenChangingTheSlotDuration_thenItIsRejected()
            throws Exception {
        // given
        jdbc.sql("""
                INSERT INTO opening_hours (id, day_of_week, opens_at, closes_at)
                VALUES ('eeeeeeee-0000-0000-0000-000000000001', 1, '08:30', '20:30')
                """).update();

        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace("\"slotMinutes\": 30", "\"slotMinutes\": 60"))
                        .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:slot-duration-conflict"))
                .andExpect(jsonPath("$.violations[0].code").value("config.slotMinutes.openingHoursConflict"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenASlotDurationOutsideThePermittedSteps_whenChangingTheConfig_thenItIsRejected()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("Example Tennis Club").replace("\"slotMinutes\": 30", "\"slotMinutes\": 7"))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("slotMinutes"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAColourThatIsNotAHexTriplet_whenChangingTheConfig_thenItIsRejected()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "blue",
                                 "accentColor": "#f78166", "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("primaryColor"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenThePrimaryColorIsMissing_whenChangingTheConfig_thenTheViolationNamesTheField()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "accentColor": "#f78166",
                                 "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.length()").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("primaryColor"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotNull"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheAccentColorIsMissing_whenChangingTheConfig_thenTheViolationNamesTheField()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "#004f2d",
                                 "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.length()").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("accentColor"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotNull"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheDefaultLocaleIsMissing_whenChangingTheConfig_thenTheViolationNamesTheField()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "#004f2d",
                                 "accentColor": "#f78166", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.length()").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("defaultLocale"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotNull"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALogoUrlThatIsNeitherAbsoluteNorARootRelativePath_whenChangingTheConfig_thenItIsRejected()
            throws Exception {
        // when / then
        String body = mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "#004f2d",
                                 "accentColor": "#f78166", "logoUrl": "javascript:alert(1)",
                                 "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("logoUrl"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"))
                .andExpect(jsonPath("$.fieldErrors[0].params").isEmpty())
                .andExpect(jsonPath("$.fieldErrors[0].message").doesNotExist())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("https?");
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAClubNameLongerThanTheLimit_whenChangingTheConfig_thenTheViolationCarriesSizeParams()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "%s", "primaryColor": "#004f2d",
                                 "accentColor": "#f78166", "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """.formatted("A".repeat(101)))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("clubName"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"))
                .andExpect(jsonPath("$.fieldErrors[0].params.length()").value(2))
                .andExpect(jsonPath("$.fieldErrors[0].params.min").value(0))
                .andExpect(jsonPath("$.fieldErrors[0].params.max").value(100));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALogoUrlThatIsProtocolRelative_whenChangingTheConfig_thenItIsRejected()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "#004f2d",
                                 "accentColor": "#f78166", "logoUrl": "//evil.example/x.png",
                                 "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("logoUrl"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnsupportedDefaultLocale_whenChangingTheConfig_thenItIsRejected() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "#004f2d",
                                 "accentColor": "#f78166", "defaultLocale": "fr", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("defaultLocale"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALogoUrlThatIsBackslashRelative_whenChangingTheConfig_thenItIsRejected()
            throws Exception {
        // when / then — a WHATWG-compliant browser resolves "/\evil.example" the same as
        // "//evil.example": a cross-origin URL, not a root-relative path
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "#004f2d",
                                 "accentColor": "#f78166", "logoUrl": "/\\\\evil.example",
                                 "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("logoUrl"));
    }

    private static String configJson(String clubName) {
        return """
                {"clubName": "%s", "primaryColor": "#004f2d", "accentColor": "#c8a415",
                 "logoUrl": "/branding/logo.svg", "imprintUrl": "https://example-tennis-club.example/imprint",
                 "defaultLocale": "de", "timeZone": "Europe/Berlin", "slotMinutes": 30}
                """.formatted(clubName);
    }
}
