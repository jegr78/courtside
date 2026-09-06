package org.courtside.dataexchange.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.Charset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, MemberTestFixture.class})
class ExportAdminControllerTest extends AbstractIntegrationTest {

    private static final Charset WINDOWS_1252 = Charset.forName("windows-1252");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private MemberTestFixture roster;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        roster.addPerson("Renée", "Major", "renee.major@example.org");
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void givenARosterToTakeOut_whenItIsExported_thenTheAnswerIsAFileTheBrowserSaves() throws Exception {
        // when / then
        String written = mockMvc.perform(post("/api/admin/export/roster").with(csrf()))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/csv"))
                .andExpect(header().string("Content-Disposition",
                        "attachment; filename=\"roster-2026-05-12.csv\""))
                .andReturn().getResponse().getContentAsString();

        assertThat(written).contains("memberNumber,firstName,lastName").contains("Renée,Major");
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void givenAClubWhoseSpreadsheetReadsWindows1252_whenItExports_thenTheBytesAreInThatCharacterSet()
            throws Exception {
        // when
        byte[] written = mockMvc.perform(post("/api/admin/export/roster")
                        .param("encoding", "windows-1252").param("separator", ";").with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();

        // then
        assertThat(new String(written, WINDOWS_1252)).contains(";Renée;Major;");
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void givenAnEncodingNoCharsetProvides_whenItExports_thenTheAnswerNamesTheEncodingBack()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/roster").param("encoding", "utf-9").with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:snapshot-encoding-unsupported"))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("import.snapshot.encodingUnsupported"));
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void givenAnEncodingThatOnlyReads_whenItExports_thenItIsRefusedRatherThanFailingToWrite()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/roster")
                        .param("encoding", "x-JISAutoDetect").with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code")
                        .value("import.snapshot.encodingUnsupported"))
                .andExpect(jsonPath("$.violations[0].params.encoding").value("x-JISAutoDetect"));
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void givenASeparatorTheDocumentDoesNotAllow_whenItExports_thenTheFieldIsNamedBack()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/roster").param("separator", "\"").with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("separator"));
    }

    @Test
    @WithMockUser(roles = "MEMBER")
    void givenAMemberRatherThanABoard_whenTheyAskForTheRoster_thenTheyAreRefused() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/export/roster").with(csrf()))
                .andExpect(status().isForbidden());
    }
}
