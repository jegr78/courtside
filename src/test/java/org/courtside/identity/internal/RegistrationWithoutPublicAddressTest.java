package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.config.testfixture.ConfigTestFixture;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(ConfigTestFixture.class)
class RegistrationWithoutPublicAddressTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private ConfigTestFixture config;
    @Autowired
    private UserAccountRepository accounts;

    @Test
    void givenExternalBookingsAdmittedButNoPublicAddress_whenSomebodyRegisters_thenRegistrationIsClosed()
            throws Exception {
        // given
        MockMvc mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        config.admitExternalBookings(true);

        // when / then
        mockMvc.perform(post("/api/registration").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"firstName":"John","lastName":"Roe","username":"roe.john",
                                "password":"Carefully chosen court phrase 47","email":"john.roe@example.org",
                                "language":"en"}"""))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:registration-closed"));
        assertThat(accounts.findByUsername("roe.john")).as("a link nobody can open must not be mailed").isEmpty();
    }
}
