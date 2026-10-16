package org.courtside.notification.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WithMockUser(username = "admin", roles = "ADMIN")
class MessageTemplateAdminControllerTest extends AbstractIntegrationTest {

    private static final String REMINDER = "/api/admin/message-templates/ACCOUNT_USERNAME_REMINDER/en";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        jdbc.sql("DELETE FROM message_template_override").update();
    }

    @Test
    void givenAClubWording_whenStoredAndListed_thenItStandsBesideTheShippedOne() throws Exception {
        // when
        mockMvc.perform(put(REMINDER).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subject": "{clubName}: your login", "body": "Hi {firstName}, it is {username}."}
                                """))
                .andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/admin/message-templates"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.kind == 'ACCOUNT_USERNAME_REMINDER')].requiredPlaceholders[0]")
                        .value("username"))
                .andExpect(jsonPath("$[?(@.kind == 'ACCOUNT_USERNAME_REMINDER')].languages[1].own.body")
                        .value("Hi {firstName}, it is {username}."))
                .andExpect(jsonPath("$[?(@.kind == 'ACCOUNT_USERNAME_REMINDER')].languages[0].own")
                        .value(contains(nullValue())))
                .andExpect(jsonPath("$[?(@.kind == 'BOOKING_CONFIRMED')].placeholders[*]", hasItem("instanceLink")));
    }

    @Test
    void givenAWordingWithoutTheUsername_whenStored_thenTheRefusalNamesThePlaceholder() throws Exception {
        // when / then
        mockMvc.perform(put(REMINDER).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subject": "{clubName}", "body": "Hi {firstName}, ask the board {nickname}."}
                                """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:message-template-refused"))
                .andExpect(jsonPath("$.violations[0].code").value("messageTemplate.placeholder.unknown"))
                .andExpect(jsonPath("$.violations[0].params.placeholder").value("nickname"))
                .andExpect(jsonPath("$.violations[1].code").value("messageTemplate.placeholder.missing"))
                .andExpect(jsonPath("$.violations[1].params.placeholder").value("username"));
    }

    @Test
    void givenAClubWording_whenReset_thenTheShippedWordingAppliesAgain() throws Exception {
        // given
        mockMvc.perform(put(REMINDER).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"subject": "{clubName}: your login", "body": "Hi {firstName}, it is {username}."}
                        """));

        // when
        mockMvc.perform(delete(REMINDER).with(csrf())).andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/admin/message-templates"))
                .andExpect(jsonPath("$[?(@.kind == 'ACCOUNT_USERNAME_REMINDER')].languages[1].own")
                        .value(contains(nullValue())));
    }

    @Test
    void givenAWording_whenPreviewed_thenItIsFilledWithExampleValues() throws Exception {
        // when / then
        mockMvc.perform(post(REMINDER + "/preview").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subject": "Login", "body": "Hi {firstName}, it is {username}."}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("Hi Jane, it is jane.doe."));
    }

    @Test
    void givenASubjectLongerThanAllowed_whenStored_thenTheFieldIsRefused() throws Exception {
        // when / then
        mockMvc.perform(put(REMINDER).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subject\": \"" + "x".repeat(201) + "\", \"body\": \"{username}\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("subject"));
    }

    @Test
    @WithMockUser(username = "member", roles = "MEMBER")
    void givenAMember_whenTheTemplatesAreRead_thenAccessIsRefused() throws Exception {
        // when / then
        mockMvc.perform(get("/api/admin/message-templates")).andExpect(status().isForbidden());
    }
}
