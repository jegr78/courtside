package org.courtside.member.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ParticipantMemberControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private MemberRepository members;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenMembersAndANonMember_whenSearchingByName_thenOnlyMatchingMembersAreReturned() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        Person john = persons.save(new Person("John", "Roe", "john.roe@example.org"));
        persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        members.save(new Member(jane.getId(), MEMBERSHIP_TYPE_ID));
        members.save(new Member(john.getId(), MEMBERSHIP_TYPE_ID));

        // when / then
        mockMvc.perform(get("/api/public/participant-members").queryParam("query", "do"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].personId").value(jane.getId().toString()))
                .andExpect(jsonPath("$[0].displayName").value("Jane Doe"));
    }

    @Test
    void givenNoSession_whenSearchingMembers_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/participant-members").queryParam("query", "do"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAShortQuery_whenSearchingMembers_thenItIsRejectedByTheContract() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/participant-members").queryParam("query", "d"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("query"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenWildcardCharacters_whenSearchingMembers_thenTheyAreMatchedLiterally() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        members.save(new Member(jane.getId(), MEMBERSHIP_TYPE_ID));

        // when / then
        mockMvc.perform(get("/api/public/participant-members").queryParam("query", "%%"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }
}
