package org.courtside.booking.web;

import org.courtside.AbstractIntegrationTest;
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

@Import({IdentityTestFixture.class, MemberTestFixture.class, RulesTestFixture.class})
class BookingEligibilityControllerTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberTestFixture members;

    @Autowired
    private RulesTestFixture rules;

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

    private void createAccountWithMembership(String firstName, String lastName, String username,
                                             Role role, boolean barred) {
        UUID personId = identity.createPerson(firstName, lastName, username + "@example.org");
        identity.createEnabledAccount(personId, username, Set.of(role));
        UUID ruleSetId = barred ? rules.ruleSetBarringCourtBookings(username) : null;
        UUID membershipTypeId = members.membershipTypeMeasuredBy(username, ruleSetId);
        members.assignMembership(personId, membershipTypeId);
    }
}
