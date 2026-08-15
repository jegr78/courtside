package org.courtside.member.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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

class RosterAdminControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAMemberAndAChild_whenListingTheRoster_thenBothAppearAndOnlyTheMemberHasAnAccount()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(jane, "jane.doe", "hash", Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);
        members.save(new Member(jane.getId(), MEMBERSHIP_TYPE_ID));
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when / then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(2))
                .andExpect(jsonPath("$.nextCursor").doesNotExist())
                .andExpect(jsonPath("$.entries[0].personId").value(jane.getId().toString()))
                .andExpect(jsonPath("$.entries[0].username").value("jane.doe"))
                .andExpect(jsonPath("$.entries[0].accountId").value(account.getId().toString()))
                .andExpect(jsonPath("$.entries[0].enabled").value(true))
                .andExpect(jsonPath("$.entries[0].membershipTypeId").value(MEMBERSHIP_TYPE_ID.toString()))
                .andExpect(jsonPath("$.entries[0].roles[0]").value("MEMBER"))
                .andExpect(jsonPath("$.entries[1].personId").value(mary.getId().toString()))
                .andExpect(jsonPath("$.entries[1].email").value("mary.major@example.org"))
                .andExpect(jsonPath("$.entries[1].username").doesNotExist())
                .andExpect(jsonPath("$.entries[1].accountId").doesNotExist())
                .andExpect(jsonPath("$.entries[1].enabled").value(false))
                .andExpect(jsonPath("$.entries[1].roles.length()").value(0));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenMorePeopleThanTheLimit_whenListingTheRoster_thenTheCursorNamesTheLastEntry()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries.length()").value(1))
                .andExpect(jsonPath("$.entries[0].personId").value(jane.getId().toString()))
                .andExpect(jsonPath("$.nextCursor").value(jane.getId().toString()));
    }

    @Test
    void givenNoSession_whenListingTheRoster_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenListingTheRoster_thenItIsDenied() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALimitAboveTheContractMaximum_whenListingTheRoster_thenItIsRejectedByTheContract()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("limit", "201"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("limit"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Max"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAQueryLongerThanTheContractAllows_whenListingTheRoster_thenItIsRejectedByTheContract()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("query", "d".repeat(61)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("query"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"));
    }
}
