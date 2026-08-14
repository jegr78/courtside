package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Optional;
import java.util.Set;

import static org.courtside.identity.AccountFixtures.enabled;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PasswordRehashFailureTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @MockitoBean
    private UserAccountRepository accounts;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenTheRehashWriteFails_whenTheMemberSignsIn_thenTheLoginStillSucceeds() throws Exception {
        // given
        Argon2PasswordEncoder weaker = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);
        UserAccount account = enabled(new UserAccount(
                new Person("John", "Roe", "john.roe@example.org"),
                "roe.john", weaker.encode(PASSWORD), Set.of(Role.MEMBER)));
        when(accounts.findByUsername("roe.john")).thenReturn(Optional.of(account));
        when(accounts.rehashPassword(any(), any(), any()))
                .thenThrow(new DataAccessResourceFailureException("read-only replica"));

        // when / then
        mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", "roe.john")
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk());
    }
}
