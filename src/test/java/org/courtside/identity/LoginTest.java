package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class LoginTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();

        Person jane = persons.save(new Person("Jane", "Doe", "family@example.org"));
        Person john = persons.save(new Person("John", "Roe", "family@example.org"));

        accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.MEMBER))));
        accounts.save(enabled(new UserAccount(
                john, "roe.john", passwordEncoder.encode("battery-staple"), Set.of(Role.MEMBER))));
    }

    @Test
    void givenTwoAccountsSharingOneEmailAddress_whenEachLogsIn_thenBothSucceed() throws Exception {
        // when / then
        mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/session")
                        .param("username", "roe.john")
                        .param("password", "battery-staple")
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    @Test
    void givenAnEnabledAccount_whenLoggingInWithAWrongPassword_thenUnauthorized() throws Exception {
        // when / then
        mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "wrong")
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.title").value("Not authenticated"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenAnAccountAwaitingApproval_whenLoggingIn_thenUnauthorized() throws Exception {
        // given
        Person pending = persons.save(new Person("Mary", "Major", "new@example.org"));
        accounts.save(new UserAccount(
                pending, "major.mary", passwordEncoder.encode("secret"), Set.of(Role.MEMBER)));

        // when / then — the body must be indistinguishable from a wrong password, so it never
        // confirms whether an account exists
        mockMvc.perform(post("/api/session")
                        .param("username", "major.mary")
                        .param("password", "secret")
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.title").value("Not authenticated"))
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    private UserAccount enabled(UserAccount account) {
        account.enable();
        return account;
    }
}
