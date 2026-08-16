package org.courtside.member.web;

import com.jayway.jsonpath.JsonPath;
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
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
    void givenACursorNamingSomebodyWhoIsGone_whenListingTheRoster_thenTheStaleCursorIsReported()
            throws Exception {
        // given
        persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(get("/api/admin/roster").queryParam("cursor", UUID.randomUUID().toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:roster-cursor-unknown"))
                .andExpect(jsonPath("$.violations[0].code").value("roster.cursor.unknown"));
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

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenCreatingAPerson_thenTheResponseCarriesTheEntryAndItsLocation() throws Exception {
        // when
        MockHttpServletResponse response = mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName": "Mary", "lastName": "Major",
                                 "email": "mary.major@example.org"}
                                """)
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.firstName").value("Mary"))
                .andExpect(jsonPath("$.lastName").value("Major"))
                .andExpect(jsonPath("$.email").value("mary.major@example.org"))
                .andExpect(jsonPath("$.accountId").doesNotExist())
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.roles.length()").value(0))
                .andReturn().getResponse();

        // then
        UUID personId = UUID.fromString(JsonPath.read(response.getContentAsString(), "$.personId"));
        assertThat(response.getHeader("Location")).isEqualTo("/api/admin/roster/" + personId);
        assertThat(persons.findById(personId)).get()
                .satisfies(person -> assertThat(person.getDisplayName()).isEqualTo("Mary Major"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABlankFirstName_whenCreatingAPerson_thenTheContractNamesTheField() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName": "   ", "lastName": "Major",
                                 "email": "mary.major@example.org"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("firstName"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnEmailWithoutAnAtSign_whenCreatingAPerson_thenTheContractNamesTheField()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName": "Mary", "lastName": "Major", "email": "nowhere"}
                                """)
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("email"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Email"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAPerson_whenChangingThem_thenTheResponseCarriesTheCorrection() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName": "Jane", "lastName": "Major",
                                 "email": "jane.major@example.org"}
                                """)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.personId").value(jane.getId().toString()))
                .andExpect(jsonPath("$.lastName").value("Major"))
                .andExpect(jsonPath("$.email").value("jane.major@example.org"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUnknownPerson_whenChangingThem_thenTheResponseCarriesItsOwnType() throws Exception {
        // when / then — a 404 from a missing row and a 404 from an unmapped path are the same
        // number, so the type is what tells them apart
        mockMvc.perform(put("/api/admin/roster/{personId}", UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName": "Jane", "lastName": "Doe",
                                 "email": "jane.doe@example.org"}
                                """)
                        .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:person-not-found"));
    }

    @Test
    void givenNoSession_whenCreatingAPerson_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(post("/api/admin/roster")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName": "Mary", "lastName": "Major",
                                 "email": "mary.major@example.org"}
                                """)
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMemberSession_whenChangingAPerson_thenItIsDenied() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        mockMvc.perform(put("/api/admin/roster/{personId}", jane.getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName": "Jane", "lastName": "Major",
                                 "email": "jane.major@example.org"}
                                """)
                        .with(csrf()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
    }
}
