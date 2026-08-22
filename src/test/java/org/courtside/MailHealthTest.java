package org.courtside;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// The relay in the test configuration has nothing listening behind it, which is what makes the
// aggregate staying UP an assertion rather than a coincidence.
class MailHealthTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void whenAnAdministratorAsksForTheMailHealth_thenItNamesTheSendingPath() throws Exception {
        // when / then
        mockMvc.perform(get("/actuator/health/mail"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components.mailRelay.details.relay").value("localhost:2525"))
                .andExpect(jsonPath("$.components.mailRelay.details.from").value("no-reply@courtside.test"))
                .andExpect(jsonPath("$.components.mailRelay.details.replyTo").value("board@courtside.test"))
                .andExpect(jsonPath("$.components.mailRelay.details.authenticates").value(false));
    }

    @Test
    @WithMockUser(username = "doe.jane", roles = "MEMBER")
    void givenAMember_whenAskingForTheMailHealth_thenTheSendingPathStaysHidden() throws Exception {
        // when / then
        mockMvc.perform(get("/actuator/health/mail")).andExpect(status().isForbidden());
    }

    @Test
    void givenNothingListeningOnTheRelay_whenCallingHealth_thenTheInstanceStaysUp() throws Exception {
        // when / then
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void whenCallingHealthWithoutAuthentication_thenNoSendingPathIsDisclosed() throws Exception {
        // when / then
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.components").doesNotExist());
    }
}
