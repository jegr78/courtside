package org.courtside.operations.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class OperationalLogAdminControllerTest extends AbstractIntegrationTest {

    private static final Path LOGS = createLogDirectory();

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserDetailsService users;

    private MockMvc mockMvc;
    private UserDetails administrator;
    private UserDetails member;

    @DynamicPropertySource
    static void operationalLogs(DynamicPropertyRegistry properties) {
        properties.add("courtside.operational-logs.path", LOGS::toString);
    }

    @BeforeEach
    void setUp() throws Exception {
        try (var files = Files.list(LOGS)) {
            for (Path file : files.toList()) {
                Files.delete(file);
            }
        }
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID adminPerson = identity.createPerson("Admin", "Operator", "admin@example.org");
        identity.createEnabledAccount(adminPerson, "admin.operator", Set.of(Role.ADMIN));
        administrator = users.loadUserByUsername("admin.operator");
        UUID memberPerson = identity.createPerson("Member", "Viewer", "member@example.org");
        identity.createEnabledAccount(memberPerson, "member.viewer", Set.of(Role.MEMBER));
        member = users.loadUserByUsername("member.viewer");
    }

    @Test
    void givenAnAdministratorAndPrivateCriteria_whenSearching_thenTheMatchingPageIsReturned() throws Exception {
        OperationalLogStore store = new OperationalLogStore(LOGS, 8_192, 5);
        store.append(new OperationalLogRecord(UUID.randomUUID(), Instant.parse("2026-09-19T14:00:00Z"),
                OperationalLogSource.APPLICATION, OperationalLogSeverity.ERROR,
                "role update failed", "0123456789abcdef0123456789abcdef"));

        mockMvc.perform(post("/api/admin/operational-logs/search")
                        .with(user(administrator)).with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"source":"APPLICATION","severity":"ERROR","text":"role update","traceId":"0123456789abcdef0123456789abcdef"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availability").value("AVAILABLE"))
                .andExpect(jsonPath("$.entries[0].source").value("APPLICATION"))
                .andExpect(jsonPath("$.entries[0].message").value("role update failed"))
                .andExpect(jsonPath("$.entries[0].traceId").value("0123456789abcdef0123456789abcdef"));
    }

    @Test
    void givenAConfiguredViewWithoutCollectorEvidence_whenSearching_thenUnavailableIsExplicit() throws Exception {
        mockMvc.perform(post("/api/admin/operational-logs/search")
                        .with(user(administrator)).with(csrf())
                        .contentType("application/json").content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availability").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.entries").isEmpty());
    }

    @Test
    void givenAMemberOrMissingCsrf_whenSearching_thenAccessIsRefused() throws Exception {
        mockMvc.perform(post("/api/admin/operational-logs/search")
                        .with(user(member)).with(csrf())
                        .contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/admin/operational-logs/search")
                        .with(user(administrator))
                        .contentType("application/json").content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void givenAnInvalidTimeRange_whenSearching_thenTheProblemNamesTheRejectedRule() throws Exception {
        mockMvc.perform(post("/api/admin/operational-logs/search")
                        .with(user(administrator)).with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"from":"2026-09-19T15:00:00Z","to":"2026-09-19T14:00:00Z"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("operationalLogs.range.invalid"));
    }

    @Test
    void givenInjectionShapedText_whenSearching_thenItRemainsAnOrdinaryNonMatchingFragment() throws Exception {
        OperationalLogStore store = new OperationalLogStore(LOGS, 8_192, 5);
        store.append(new OperationalLogRecord(UUID.randomUUID(), Instant.parse("2026-09-19T14:00:00Z"),
                OperationalLogSource.APPLICATION, OperationalLogSeverity.ERROR,
                "role update failed", null));

        mockMvc.perform(post("/api/admin/operational-logs/search")
                        .with(user(administrator)).with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"text":"' OR 1=1 --"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availability").value("AVAILABLE"))
                .andExpect(jsonPath("$.entries").isEmpty());
    }

    @Test
    void givenAnUnknownCursor_whenSearching_thenTheProblemNamesTheRejectedCursor() throws Exception {
        new OperationalLogStore(LOGS, 8_192, 5);

        mockMvc.perform(post("/api/admin/operational-logs/search")
                        .with(user(administrator)).with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"cursor":"11111111-1111-1111-1111-111111111111"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.violations[0].code").value("operationalLogs.cursor.unknown"));
    }

    private static Path createLogDirectory() {
        try {
            return Files.createTempDirectory("courtside-operational-logs-test-");
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }
}
