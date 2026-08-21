package org.courtside.dataexchange.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.dataexchange.CanonicalField;
import org.courtside.dataexchange.ImportSourceService;
import org.courtside.dataexchange.PreviewService;
import org.courtside.dataexchange.SnapshotMode;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class ImportExecutionAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID ACTIVE_TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    private static final String TWO_MEMBERS = """
            Member number,First name,Last name,Email
            4711,Jane,Doe,jane.doe@example.org
            4712,John,Roe,john.roe@example.org
            """;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private ImportSourceService sources;

    @Autowired
    private PreviewService previews;


    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    private MockMvc mockMvc;

    private UUID source;
    private UUID actor;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        source = sources.create("roster-system", "Membership system", ",",
                Map.of("Member number", CanonicalField.EXTERNAL_ID,
                        "First name", CanonicalField.FIRST_NAME,
                        "Last name", CanonicalField.LAST_NAME,
                        "Email", CanonicalField.EMAIL),
                Map.of(), ACTIVE_TYPE, Set.of(CanonicalField.FIRST_NAME), 10).sourceId();
        UUID admin = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        actor = identity.createAccount(admin, "admin", Set.of(Role.ADMIN));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAReviewedPreview_whenItIsExecuted_thenTheOutcomeIsReportedAndLogged() throws Exception {
        // when
        mockMvc.perform(execute(preview(TWO_MEMBERS), null))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(2))
                .andExpect(jsonPath("$.membershipsEnded").value(0))
                .andExpect(jsonPath("$.removalsConfirmed").value(false))
                .andExpect(jsonPath("$.fileHash").exists());

        // then
        assertThat(members.count()).isEqualTo(2);
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/runs", source))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].created").value(2));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenMoreRemovalsThanAllowed_whenExecutingWithoutConfirmation_thenTheCountAndShareAreNamed()
            throws Exception {
        // given
        mockMvc.perform(execute(preview(TWO_MEMBERS), null)).andExpect(status().isOk());
        UUID shorter = preview("""
                Member number,First name,Last name,Email
                4711,Jane,Doe,jane.doe@example.org
                """);

        // when / then
        mockMvc.perform(execute(shorter, null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type")
                        .value("urn:courtside:error:import-removals-need-confirmation"))
                .andExpect(jsonPath("$.violations[0].code").value("import.removals.needConfirmation"))
                .andExpect(jsonPath("$.violations[0].params.count").value(1))
                .andExpect(jsonPath("$.violations[0].params.percent").value(50));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenTheSameRemovals_whenTheyAreConfirmed_thenTheRunProceeds() throws Exception {
        // given
        mockMvc.perform(execute(preview(TWO_MEMBERS), null)).andExpect(status().isOk());
        UUID shorter = preview("""
                Member number,First name,Last name,Email
                4711,Jane,Doe,jane.doe@example.org
                """);

        // when / then
        mockMvc.perform(execute(shorter, "{\"confirmRemovals\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipsEnded").value(1))
                .andExpect(jsonPath("$.removalsConfirmed").value(true));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnExecutedPreview_whenItIsExecutedAgain_thenTheReasonIsNamed() throws Exception {
        // given
        UUID previewId = preview(TWO_MEMBERS);
        mockMvc.perform(execute(previewId, null)).andExpect(status().isOk());

        // when / then
        mockMvc.perform(execute(previewId, null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-preview-superseded"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPreviewNobodyTook_whenExecuting_thenItIsReportedAsNotFound() throws Exception {
        // when / then
        mockMvc.perform(execute(UUID.randomUUID(), null))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:import-preview-not-found"));
    }

    @Test
    void givenNoSession_whenExecuting_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(execute(UUID.randomUUID(), null))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenExecuting_thenItIsDenied() throws Exception {
        // when / then
        mockMvc.perform(execute(UUID.randomUUID(), null))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenReadingTheRunLog_thenItIsDenied() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/import/sources/{sourceId}/runs", source))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    private RequestBuilder execute(UUID previewId, String body) {
        var request = post("/api/admin/import/previews/{id}/execution", previewId)
                .contentType(MediaType.APPLICATION_JSON)
                .with(csrf());
        return body == null ? request : request.content(body);
    }

    private UUID preview(String content) {
        return previews.create(source, SnapshotMode.FULL_SNAPSHOT, "UTF-8", "roster.csv",
                content.getBytes(StandardCharsets.UTF_8), actor).previewId();
    }
}
