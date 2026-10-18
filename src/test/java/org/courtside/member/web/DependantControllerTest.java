package org.courtside.member.web;

import jakarta.mail.internet.MimeMessage;
import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.GuardianGrant;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasEntry;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({IdentityTestFixture.class, MemberTestFixture.class, AuditTestFixture.class})
class DependantControllerTest extends AbstractIntegrationTest {

    private static final String CREDENTIALS_REQUESTED = "roster.account.credentialsRequested";

    @MockitoSpyBean
    private JavaMailSender sender;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private UserDetailsService userDetails;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private AuditTestFixture audit;

    @Autowired
    private Clock clock;

    private MockMvc mockMvc;
    private UUID jane;
    private UUID janeAccount;
    private UUID john;
    private UUID mary;

    @BeforeEach
    void setUp() {
        doNothing().when(sender).send(any(MimeMessage.class));
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .defaultRequest(get("/").sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli()))
                .apply(springSecurity())
                .build();
        jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        janeAccount = identity.createEnabledAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        john = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(john, "roe.john", Set.of(Role.MEMBER));
        mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        identity.createEnabledAccount(mary, "major.mary", Set.of(Role.MEMBER));
    }

    @Test
    void givenRelationshipsOfSeveralKinds_whenAGuardianListsDependants_thenOnlyTheirRunningOnesShowByName()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.VIEW_BOOKINGS, GuardianGrant.BOOK));
        UUID ended = members.linkGuardian(jane, mary, Set.of(GuardianGrant.BOOK));
        members.endGuardianship(jane, ended);
        members.linkGuardian(mary, jane, Set.of(GuardianGrant.BOOK));

        // when / then
        mockMvc.perform(get("/api/my/dependants").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].personId").value(john.toString()))
                .andExpect(jsonPath("$[0].firstName").value("John"))
                .andExpect(jsonPath("$[0].lastName").value("Roe"))
                .andExpect(jsonPath("$[0].grants", contains("VIEW_BOOKINGS", "BOOK")))
                .andExpect(jsonPath("$[0]", hasEntry("endedOn", null)))
                .andExpect(jsonPath("$[0].email").doesNotExist());
    }

    @Test
    void givenARelationshipWithAnEnd_whenTheGuardianListsDependants_thenTheEndIsShown() throws Exception {
        // given
        members.linkGuardianUntil(jane, john, Set.of(GuardianGrant.BOOK), LocalDate.of(2026, 9, 1));

        // when / then
        mockMvc.perform(get("/api/my/dependants").with(as("doe.jane")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].endedOn").value("2026-09-01"));
    }

    @Test
    void givenAGuardianGrantedAccountTasks_whenAskingForTheDependantsCredentials_thenTheyAreIssuedOnTheGuardiansWord()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.ACCOUNT_TASKS));

        // when
        mockMvc.perform(post("/api/my/dependants/{personId}/credentials", john).with(as("doe.jane")).with(csrf()))
                .andExpect(status().isNoContent());

        // then
        assertThat(audit.eventsAbout(john, CREDENTIALS_REQUESTED))
                .extracting(AuditTestFixture.RecordedEvent::actorAccountId)
                .as("the change log names the guardian").containsExactly(janeAccount);
    }

    @Test
    void givenARelationshipWithoutAccountTasks_whenTheGuardianAsksForCredentials_thenNothingIsIssued()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.BOOK));

        // when / then
        mockMvc.perform(post("/api/my/dependants/{personId}/credentials", john).with(as("doe.jane")).with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:guardian-action-not-granted"))
                .andExpect(jsonPath("$.violations[0].params.action").value("ACCOUNT_TASKS"));
        assertThat(audit.eventsAbout(john, CREDENTIALS_REQUESTED)).isEmpty();
    }

    @Test
    void givenAStaleSignIn_whenTheGuardianAsksForCredentials_thenAFreshProofIsRequiredAndNothingIsIssued()
            throws Exception {
        // given
        members.linkGuardian(jane, john, Set.of(GuardianGrant.ACCOUNT_TASKS));
        long stale = clock.instant().minus(Duration.ofHours(2)).toEpochMilli();

        // when / then
        mockMvc.perform(post("/api/my/dependants/{personId}/credentials", john).with(as("doe.jane")).with(csrf())
                        .sessionAttr("courtside.authenticated-at", stale))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"))
                .andExpect(jsonPath("$.violations[0].code").value("identity.reauthentication.required"));
        assertThat(audit.eventsAbout(john, CREDENTIALS_REQUESTED)).isEmpty();
    }

    private RequestPostProcessor as(String username) {
        return SecurityMockMvcRequestPostProcessors.user(userDetails.loadUserByUsername(username));
    }
}
