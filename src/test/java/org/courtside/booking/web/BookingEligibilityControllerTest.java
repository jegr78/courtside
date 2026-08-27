package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.testfixture.MemberTestFixture;
import org.courtside.rules.testfixture.RulesTestFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.UUID;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import({ConfigTestFixture.class, IdentityTestFixture.class, MemberTestFixture.class,
        RulesTestFixture.class})
class BookingEligibilityControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private RulesTestFixture rules;

    @Autowired
    private ConfigTestFixture clubConfiguration;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAnonymousCaller_whenReadingBookingEligibility_thenUnauthorized() throws Exception {
        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenABarredMember_whenReadingBookingEligibility_thenTheCodedViolationIsReturned()
            throws Exception {
        // given
        createAccountWithMembership("Jane", "Doe", "doe.jane", Role.MEMBER, true);

        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].code")
                        .value("booking.rule.noCourtBooking"))
                .andExpect(jsonPath("$.violations[0].params").isEmpty());
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "MEMBER")
    void givenAnAllowedMember_whenReadingBookingEligibility_thenNoViolationIsReturned()
            throws Exception {
        // given
        createAccountWithMembership("John", "Roe", "roe.john", Role.MEMBER, false);

        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.violations").isEmpty());
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenABarredAdministrator_whenReadingBookingEligibility_thenNoViolationIsReturned()
            throws Exception {
        // given
        createAccountWithMembership("Mary", "Major", "major.mary", Role.ADMIN, true);

        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.violations").isEmpty());
    }

    @Test
    @WithMockUser(username = "miles.richard", roles = "MEMBER")
    void givenAMemberWhoseRuleSetBoundsDuration_whenReadingEligibility_thenTheBoundIsReturned()
            throws Exception {
        // given
        UUID personId = identity.createPerson("Richard", "Miles", "miles.richard@example.org");
        identity.createEnabledAccount(personId, "miles.richard", Set.of(Role.MEMBER));
        members.assignMembership(personId, members.membershipTypeMeasuredBy("Short slots",
                rules.ruleSetBoundingBookingDuration("Short slots", 90)));

        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maxBookingMinutes").value(90));
    }

    @Test
    @WithMockUser(username = "roe.john", roles = "MEMBER")
    void givenAMemberWhoseRuleSetBoundsNothing_whenReadingEligibility_thenNoBoundIsReturned()
            throws Exception {
        // given
        createAccountWithMembership("John", "Roe", "roe.john", Role.MEMBER, false);

        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maxBookingMinutes").doesNotExist());
    }

    @Test
    @WithMockUser(username = "major.mary", roles = "ADMIN")
    void givenAnAdministratorWhoseRuleSetBoundsDuration_whenReadingEligibility_thenNoBoundIsReturned()
            throws Exception {
        // given — the role sets every restriction aside, so a bound the client honours would be a lie
        UUID personId = identity.createPerson("Mary", "Major", "major.mary@example.org");
        identity.createEnabledAccount(personId, "major.mary", Set.of(Role.ADMIN));
        members.assignMembership(personId, members.membershipTypeMeasuredBy("Short slots",
                rules.ruleSetBoundingBookingDuration("Short slots", 90)));

        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maxBookingMinutes").doesNotExist());
    }

    @Test
    @WithMockUser(username = "public.peter", roles = "MEMBER")
    void givenTheClubRuleSetBoundsDuration_whenSomebodyHoldsNoMembershipType_thenTheBoundIsReturned()
            throws Exception {
        // given — holding no membership type is where a bound is easiest to lose
        UUID personId = identity.createPerson("Peter", "Public", "public.peter@example.org");
        identity.createEnabledAccount(personId, "public.peter", Set.of(Role.MEMBER));
        clubConfiguration.bindPeopleWithoutAMembershipTypeTo(
                rules.ruleSetBoundingBookingDuration("Short slots", 90));

        // when / then
        mockMvc.perform(get("/api/bookings/eligibility"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maxBookingMinutes").value(90));
    }

    private void createAccountWithMembership(String firstName, String lastName, String username,
                                             Role role, boolean barred) {
        UUID personId = identity.createPerson(firstName, lastName, username + "@example.org");
        identity.createEnabledAccount(personId, username, Set.of(role));
        UUID ruleSetId = barred ? rules.ruleSetBarringCourtBookings(username) : null;
        UUID membershipTypeId = members.membershipTypeMeasuredBy(username, ruleSetId);
        members.assignMembership(personId, membershipTypeId);
    }
}
