package org.courtside.config.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
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
                .andExpect(jsonPath("$.primaryColor").value("#1f6feb"))
                .andExpect(jsonPath("$.defaultLocale").value("de"));
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
    void givenAColourThatIsNotAHexTriplet_whenChangingTheConfig_thenItIsRejected()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"clubName": "Example Tennis Club", "primaryColor": "blue",
                                 "accentColor": "#f78166", "defaultLocale": "de"}
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
                                 "defaultLocale": "de"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.length()").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("primaryColor"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotBlank"));
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
                                 "defaultLocale": "de"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.length()").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("accentColor"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotBlank"));
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
                                 "accentColor": "#f78166"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.length()").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("defaultLocale"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.NotBlank"));
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
                                 "defaultLocale": "de"}
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
                                 "accentColor": "#f78166", "defaultLocale": "de"}
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
                                 "defaultLocale": "de"}
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
                                 "accentColor": "#f78166", "defaultLocale": "fr"}
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
                                 "defaultLocale": "de"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("logoUrl"));
    }

    private static String configJson(String clubName) {
        return """
                {"clubName": "%s", "primaryColor": "#004f2d", "accentColor": "#c8a415",
                 "logoUrl": "/branding/logo.svg", "imprintUrl": "https://example-tennis-club.example/imprint",
                 "defaultLocale": "de"}
                """.formatted(clubName);
    }
}
