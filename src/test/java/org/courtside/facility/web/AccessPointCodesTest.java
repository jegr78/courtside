package org.courtside.facility.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.audit.testfixture.AuditTestFixture;
import org.courtside.audit.testfixture.AuditTestFixture.RecordedEvent;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AccessPointCodesTest extends AbstractIntegrationTest {

    private static final String CODES = "/api/groundskeeping/access-codes";
    private static final String CODES_READ = "facility.accessPoint.codesRead";
    private static final String SIGN_IN_PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private MemberTestFixture members;
    @Autowired
    private AuditTestFixture audit;
    @Autowired
    private UserDetailsService userDetailsService;
    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;
    private UUID gate;
    private UUID clubhouse;
    private UUID storeroom;

    @BeforeEach
    void aClubWithAGateAClubhouseAndARetiredStoreroom() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID court = facility.createCourt(1, "Court 1");
        gate = facility.createAccessPointWithEmergencyCode("Gate", List.of(court), "246802");
        clubhouse = facility.createAccessPoint("Clubhouse", List.of(), "135790", true);
        storeroom = facility.createAccessPoint("Storeroom", List.of(court), "975310");
        facility.deactivateAccessPoint(storeroom);
    }

    @Test
    void givenAGroundskeeper_whenReadingTheCodes_thenEveryActiveDoorComesWithItsFixedAndEmergencyCode()
            throws Exception {
        // given
        UUID account = account("roe.john", Role.MEMBER, Role.GROUNDSKEEPER);

        // when / then
        mockMvc.perform(post(CODES).with(csrf()).with(user(as("roe.john"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[*].name", contains("Clubhouse", "Gate")))
                .andExpect(jsonPath("$[0].id").value(clubhouse.toString()))
                .andExpect(jsonPath("$[0].staticCode").value("135790"))
                .andExpect(jsonPath("$[0].emergencyCode").isEmpty())
                .andExpect(jsonPath("$[1].staticCode").isEmpty())
                .andExpect(jsonPath("$[1].emergencyCode").value("246802"));
        List<RecordedEvent> reads = audit.eventsOfType(CODES_READ);
        assertThat(reads).as("each read leaves one entry naming its reader").hasSize(1);
        assertThat(reads.getFirst().actorAccountId()).isEqualTo(account);
        assertThat(reads.getFirst().payload()).as("the entry names the doors, never their codes")
                .containsOnlyKeys("accessPointIds")
                .containsEntry("accessPointIds", List.of(clubhouse.toString(), gate.toString()));
    }

    @Test
    void givenAnAdministrator_whenReadingTheCodes_thenTheyAreServedAndRecorded() throws Exception {
        // given
        UUID account = account("major.mary", Role.ADMIN);

        // when / then
        mockMvc.perform(post(CODES).with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].name", contains("Clubhouse", "Gate")));
        assertThat(audit.eventsOfType(CODES_READ)).extracting(RecordedEvent::actorAccountId)
                .containsExactly(account);
    }

    @Test
    void givenEveryOtherProductRole_whenReadingTheCodes_thenEachIsRefusedWithoutARecord() throws Exception {
        // given
        List<Role> refused = List.of(Role.MEMBER, Role.TRAINER, Role.SPORT_DIRECTOR, Role.YOUTH_DIRECTOR,
                Role.TREASURER, Role.EXTERNAL);
        for (Role role : refused) {
            account("holder." + role.name().toLowerCase(), role);
        }

        // when / then
        for (Role role : refused) {
            mockMvc.perform(post(CODES).with(csrf()).with(user(as("holder." + role.name().toLowerCase()))))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        }
        assertThat(audit.eventsOfType(CODES_READ)).as("a refused read records nothing").isEmpty();
    }

    @Test
    void givenAGroundskeeperWhoMustStillChangeTheirPassword_whenReadingTheCodes_thenTheyAreRefused()
            throws Exception {
        // given
        account("roe.john", Role.GROUNDSKEEPER);
        identity.requirePasswordChange("roe.john");

        // when / then
        mockMvc.perform(post(CODES).with(csrf()).with(user(as("roe.john"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    void givenNoSession_whenReadingTheCodes_thenTheCallerMustSignIn() throws Exception {
        // when / then
        mockMvc.perform(post(CODES).with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenAGroundskeeper_whenChangingACodeThroughTheirView_thenNoWriteExists() throws Exception {
        // given
        account("roe.john", Role.GROUNDSKEEPER);

        // when / then
        mockMvc.perform(put(CODES).with(csrf()).with(user(as("roe.john")))
                        .contentType(MediaType.APPLICATION_JSON).content("[]"))
                .andExpect(status().isMethodNotAllowed());
        mockMvc.perform(get(CODES).with(user(as("roe.john"))))
                .andExpect(status().isMethodNotAllowed());
        mockMvc.perform(put("/api/admin/access-points/" + gate).with(csrf()).with(user(as("roe.john")))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    void givenASignedInGroundskeeper_whenTheRoleIsRemoved_thenTheNextReadIsRefused() throws Exception {
        // given
        UUID person = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(person, "roe.john", passwordEncoder.encode(SIGN_IN_PASSWORD),
                Set.of(Role.MEMBER, Role.GROUNDSKEEPER));
        MockHttpSession session = signIn("roe.john");
        mockMvc.perform(post(CODES).with(csrf()).session(session)).andExpect(status().isOk());

        // when
        members.changeAccountRoles(person, Set.of(Role.MEMBER));

        // then
        mockMvc.perform(post(CODES).with(csrf()).session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
        assertThat(audit.eventsOfType(CODES_READ)).as("only the read before the removal is recorded").hasSize(1);
    }

    private UUID account(String username, Role... roles) {
        UUID person = identity.createPerson("Jane", "Doe", username + "@example.org");
        return identity.createEnabledAccount(person, username, Set.of(roles));
    }

    private UserDetails as(String username) {
        return userDetailsService.loadUserByUsername(username);
    }

    private MockHttpSession signIn(String username) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", username)
                        .param("password", SIGN_IN_PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }
}
