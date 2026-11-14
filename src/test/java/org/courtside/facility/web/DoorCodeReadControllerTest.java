package org.courtside.facility.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.RosterService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
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
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DoorCodeReadControllerTest extends AbstractIntegrationTest {

    private static final String DOOR_CODES = "/api/grounds/door-codes";
    private static final String PASSWORD = "correct-horse-battery-staple";
    private static final String ACCESS_DENIED = "urn:courtside:error:access-denied";

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private FacilityTestFixture facility;
    @Autowired
    private UserDetailsService userDetailsService;
    @Autowired
    private PasswordEncoder passwordEncoder;
    @Autowired
    private RosterService roster;
    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;
    private UUID groundskeeperPerson;
    private UUID groundskeeperAccount;
    private UUID gate;
    private UUID clubhouse;
    private UUID shed;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID court = facility.createCourt(1, "Court 1");
        gate = facility.createAccessPoint("Gate", List.of(court), "471123");
        clubhouse = facility.createAccessPointWithEmergencyCode("Clubhouse", List.of(court), "908172");
        shed = facility.createAccessPoint("Shed", List.of(court), null);
        UUID retired = facility.createAccessPoint("Old gate", List.of(court), "123456");
        facility.deactivateAccessPoint(retired);
        groundskeeperPerson = identity.createPerson("Richard", "Miles", "richard.miles@example.org");
        groundskeeperAccount = identity.createEnabledAccount(groundskeeperPerson, "miles.richard",
                passwordEncoder.encode(PASSWORD), Set.of(Role.MEMBER, Role.GROUNDSKEEPER));
        identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary.major@example.org"),
                "major.mary", Set.of(Role.ADMIN));
    }

    @Test
    void givenActiveAndRetiredDoors_whenTheGroundskeeperReadsTheCodes_thenEveryActiveDoorShowsItsCodes() throws Exception {
        // when / then
        mockMvc.perform(post(DOOR_CODES).with(csrf()).with(user(as("miles.richard"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[*].accessPointName").value(contains("Clubhouse", "Gate", "Shed")))
                .andExpect(jsonPath("$[0].accessPointId").value(clubhouse.toString()))
                .andExpect(jsonPath("$[0].staticCode").value(nullValue()))
                .andExpect(jsonPath("$[0].emergencyCode").value("908172"))
                .andExpect(jsonPath("$[1].accessPointId").value(gate.toString()))
                .andExpect(jsonPath("$[1].staticCode").value("471123"))
                .andExpect(jsonPath("$[1].emergencyCode").value(nullValue()))
                .andExpect(jsonPath("$[2].accessPointId").value(shed.toString()))
                .andExpect(jsonPath("$[2].staticCode").value(nullValue()))
                .andExpect(jsonPath("$[2].emergencyCode").value(nullValue()));
    }

    @Test
    void givenAnAdministrator_whenTheCodesAreRead_thenTheSameDoorsAreShown() throws Exception {
        // when / then
        mockMvc.perform(post(DOOR_CODES).with(csrf()).with(user(as("major.mary"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].accessPointName").value(contains("Clubhouse", "Gate", "Shed")));
    }

    @ParameterizedTest
    @EnumSource(value = Role.class, names = {"MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "TREASURER",
            "EXTERNAL"})
    void givenAnAccountWithoutTheGroundskeeperRole_whenItReadsTheCodes_thenItIsRefusedAndNothingIsRecorded(Role role)
            throws Exception {
        // given
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"), "doe.jane",
                Set.of(role));

        // when / then
        mockMvc.perform(post(DOOR_CODES).with(csrf()).with(user(as("doe.jane"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value(ACCESS_DENIED));
        assertThat(readsRecorded()).as("a refused read shows no code").isZero();
    }

    @Test
    void givenAGroundskeeper_whenItChangesADoorCode_thenTheChangeIsRefused() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/access-points/{id}", gate).with(csrf()).with(user(as("miles.richard")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name": "Gate", "courtIds": [], "staticCode": "000000", "emergencyCode": null,
                                 "openToMembers": false, "loxoneGroup": null}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value(ACCESS_DENIED));
        mockMvc.perform(post(DOOR_CODES).with(csrf()).with(user(as("miles.richard"))))
                .andExpect(jsonPath("$[1].staticCode").value("471123"));
    }

    @Test
    void givenAGroundskeeper_whenItReadsTheCodesTwice_thenEachReadIsRecordedUnderItsAccountWithoutTheCodes()
            throws Exception {
        // when
        mockMvc.perform(post(DOOR_CODES).with(csrf()).with(user(as("miles.richard")))).andExpect(status().isOk());
        mockMvc.perform(post(DOOR_CODES).with(csrf()).with(user(as("miles.richard")))).andExpect(status().isOk());

        // then
        List<RecordedRead> reads = jdbc.sql("""
                        SELECT actor_account_id, payload::text AS payload FROM domain_event
                        WHERE event_type = 'facility.doorCodes.read' ORDER BY occurred_at
                        """)
                .query((row, index) -> new RecordedRead(row.getObject("actor_account_id", UUID.class),
                        row.getString("payload")))
                .list();
        assertThat(reads).as("one entry per read").hasSize(2);
        assertThat(reads).allSatisfy(read -> {
            assertThat(read.actor()).as("the board sees who looked").isEqualTo(groundskeeperAccount);
            assertThat(read.payload()).as("the entry names the doors shown, never their codes")
                    .contains(gate.toString()).contains(clubhouse.toString()).contains(shed.toString())
                    .doesNotContain("471123").doesNotContain("908172");
        });
    }

    @Test
    void givenASignedInGroundskeeper_whenTheBoardWithdrawsTheRole_thenTheNextReadIsRefused() throws Exception {
        // given
        MockHttpSession session = signIn("miles.richard");
        mockMvc.perform(post(DOOR_CODES).with(csrf()).session(session)).andExpect(status().isOk());

        // when
        roster.changeRoles(groundskeeperPerson, Set.of(Role.MEMBER));

        // then
        mockMvc.perform(post(DOOR_CODES).with(csrf()).session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    private MockHttpSession signIn(String username) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", username)
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }

    private long readsRecorded() {
        return jdbc.sql("SELECT count(*) FROM domain_event WHERE event_type = 'facility.doorCodes.read'")
                .query(Long.class).single();
    }

    private UserDetails as(String username) {
        return userDetailsService.loadUserByUsername(username);
    }

    private record RecordedRead(UUID actor, String payload) {
    }
}
