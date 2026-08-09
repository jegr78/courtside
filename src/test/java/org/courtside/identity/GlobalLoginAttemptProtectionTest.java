package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@TestPropertySource(properties = {
        "courtside.login-protection.address.max-failures=20",
        "courtside.login-protection.global.max-failures=2"
})
class GlobalLoginAttemptProtectionTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAttemptsWithDifferentAddressesAndUsernames_whenTheBudgetIsSpent_thenLoginIsLimited()
            throws Exception {
        // given
        mockMvc.perform(login("first", "192.0.2.61")).andExpect(status().isUnauthorized());
        mockMvc.perform(login("second", "192.0.2.62")).andExpect(status().isUnauthorized());

        // when / then
        mockMvc.perform(login("third", "192.0.2.63"))
                .andExpect(status().isTooManyRequests());
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder login(
            String username, String address) {
        return post("/api/session")
                .param("username", username)
                .param("password", "wrong")
                .with(remoteAddress(address))
                .with(csrf());
    }

    private RequestPostProcessor remoteAddress(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }
}
