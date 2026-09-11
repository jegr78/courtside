package org.courtside.member.web;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.member.Member;
import org.courtside.member.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.RequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.UUID;

import static org.courtside.member.MemberFixtures.memberSince;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class ParticipantMemberControllerTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private WebApplicationContext context;


    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private MemberRepository members;

    private MockMvc mockMvc;

    private static RequestBuilder searchFor(String query) {
        return post("/api/public/participant-members").with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":" + quoted(query) + "}");
    }

    private static String quoted(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenMembersAndANonMember_whenSearchingByName_thenOnlyMatchingMembersAreReturned() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        identity.createPerson("Mary", "Major", "mary.major@example.org");
        members.save(memberSince(jane, MEMBERSHIP_TYPE_ID));
        members.save(memberSince(john, MEMBERSHIP_TYPE_ID));

        // when / then
        mockMvc.perform(searchFor("do"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].personId").value(jane.toString()))
                .andExpect(jsonPath("$[0].displayName").value("Jane Doe"));
    }

    @Test
    void givenNoSession_whenSearchingMembers_thenItIsUnauthenticated() throws Exception {
        // when / then
        mockMvc.perform(searchFor("do"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAShortQuery_whenSearchingMembers_thenItIsRejectedByTheContract() throws Exception {
        // when / then
        mockMvc.perform(searchFor("d"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("query"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenWildcardCharacters_whenSearchingMembers_thenTheyAreMatchedLiterally() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        members.save(memberSince(jane, MEMBERSHIP_TYPE_ID));

        // when / then
        mockMvc.perform(searchFor("%%"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenSqlSyntax_whenSearchingMembers_thenItRemainsALiteralNameFragment() throws Exception {
        // given
        UUID literal = identity.createPerson("' OR 1=1 --", "Literal", "literal@example.org");
        members.save(memberSince(literal, MEMBERSHIP_TYPE_ID));
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        members.save(memberSince(jane, MEMBERSHIP_TYPE_ID));

        // when / then
        mockMvc.perform(searchFor("' OR 1=1 --"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].personId").value(literal.toString()))
                .andExpect(jsonPath("$[0].displayName").value("' OR 1=1 -- Literal"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAnExplicitNullQuery_whenMembersAreSearched_thenItIsRejectedAsAFieldError()
            throws Exception {
        // when / then
        mockMvc.perform(post("/api/public/participant-members").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"query\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("query"));
    }
}
