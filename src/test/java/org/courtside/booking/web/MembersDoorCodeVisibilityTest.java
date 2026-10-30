package org.courtside.booking.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({FacilityTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class})
class MembersDoorCodeVisibilityTest extends AbstractIntegrationTest {

    private static final String CLUBHOUSE_CODE = "135790";
    private static final String NORTH_CODE = "246802";
    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private UserDetailsService userDetails;

    @Autowired
    private FacilityTestFixture facility;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    private MockMvc mockMvc;
    private UUID membershipType;
    private UUID clubhouseDoor;

    @BeforeEach
    void aClubhouseDoorOpenToMembersAndANorthGateThatIsNot() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        UUID court = facility.createCourt(1, "Court 1");
        clubhouseDoor = facility.createAccessPoint("Clubhouse door", List.of(), CLUBHOUSE_CODE, true);
        facility.createAccessPoint("North gate", List.of(court), NORTH_CODE);
        facility.createAccessPoint("South gate", List.of(court), null);
        membershipType = members.createMembershipType("Adult");
    }

    @Test
    void givenACurrentMemberWithoutAnyBooking_whenReadingTheDoorCodes_thenOnlyTheClubhouseCodeComes()
            throws Exception {
        // given
        accountWithPeriod("doe.jane", TODAY.minusMonths(4), null);

        // when
        String codes = read("doe.jane");

        // then
        assertThat(JsonPath.<List<Map<String, String>>>read(codes, "$"))
                .as("only an active door open to members, never a court gate")
                .containsExactly(Map.of("accessPointName", "Clubhouse door", "code", CLUBHOUSE_CODE));
    }

    @Test
    void givenAFormerMember_whenReadingTheDoorCodes_thenTheListIsEmpty() throws Exception {
        // given
        accountWithPeriod("roe.john", TODAY.minusYears(1), TODAY);

        // when / then
        assertThat(read("roe.john")).as("a membership that ended today no longer opens the door").isEqualTo("[]");
    }

    @Test
    void givenAFutureMember_whenReadingTheDoorCodes_thenTheListIsEmpty() throws Exception {
        // given
        accountWithPeriod("major.mary", TODAY.plusDays(1), null);

        // when / then
        assertThat(read("major.mary")).as("a membership that starts tomorrow opens nothing today").isEqualTo("[]");
    }

    @Test
    void givenACurrentMemberWhoseAccountIsDisabled_whenReadingTheDoorCodes_thenTheListIsEmpty() throws Exception {
        // given
        UUID account = accountWithPeriod("miles.richard", TODAY.minusMonths(4), null);
        identity.disableAccount(account);

        // when / then
        assertThat(read("miles.richard")).as("a disabled account is no current member").isEqualTo("[]");
    }

    @Test
    void givenAnAccountWithoutAnyMembership_whenReadingTheDoorCodes_thenTheListIsEmpty() throws Exception {
        // given
        UUID guest = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createEnabledAccount(guest, "roe.john", Set.of(Role.MEMBER));

        // when / then
        assertThat(read("roe.john")).as("an account is not a membership").isEqualTo("[]");
    }

    @Test
    void givenADeactivatedClubhouseDoor_whenACurrentMemberReadsTheDoorCodes_thenTheListIsEmpty() throws Exception {
        // given
        accountWithPeriod("doe.jane", TODAY.minusMonths(4), null);
        facility.deactivateAccessPoint(clubhouseDoor);

        // when / then
        assertThat(read("doe.jane")).as("an inactive door hands no code out").isEqualTo("[]");
    }

    private UUID accountWithPeriod(String username, LocalDate startedOn, LocalDate endedOn) {
        String[] names = username.split("\\.");
        UUID person = identity.createPerson(capitalised(names[1]), capitalised(names[0]), username + "@example.org");
        members.addMembershipPeriod(person, membershipType, startedOn, endedOn);
        return identity.createEnabledAccount(person, username, Set.of(Role.MEMBER));
    }

    private static String capitalised(String name) {
        return Character.toUpperCase(name.charAt(0)) + name.substring(1);
    }

    private String read(String username) throws Exception {
        return mockMvc.perform(get("/api/my/door-codes")
                        .with(SecurityMockMvcRequestPostProcessors.user(userDetails.loadUserByUsername(username))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }
}
