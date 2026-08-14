package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PasswordRehashTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private UserDetailsService userDetailsService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAHashBelowTheCurrentCost_whenTheAccountAuthenticates_thenItIsStoredAtTheCurrentCost() {
        // given
        Argon2PasswordEncoder weaker = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);
        Person person = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = accounts.save(new UserAccount(
                person, "doe.jane", weaker.encode(PASSWORD), Set.of(Role.MEMBER)));

        // when
        UserDetails details = userDetailsService.loadUserByUsername("doe.jane");
        ((UserDetailsPasswordService) userDetailsService).updatePassword(details, passwordEncoder.encode(PASSWORD));

        // then
        String stored = accounts.findById(account.getId()).orElseThrow().getPasswordHash();
        assertThat(stored).contains("m=19456");
        assertThat(passwordEncoder.matches(PASSWORD, stored))
                .as("the member must still be able to sign in with the same password")
                .isTrue();
    }

    @Test
    void givenAHashBelowTheCurrentCost_whenTheMemberSignsIn_thenSpringSecurityStoresTheStrongerHash()
            throws Exception {
        // given
        Argon2PasswordEncoder weaker = new Argon2PasswordEncoder(16, 32, 1, 16384, 2);
        Person person = persons.save(new Person("John", "Roe", "john.roe@example.org"));
        UserAccount account = accounts.save(enabled(new UserAccount(
                person, "roe.john", weaker.encode(PASSWORD), Set.of(Role.MEMBER))));

        // when
        mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", "roe.john")
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk());

        // then
        assertThat(accounts.findById(account.getId()).orElseThrow().getPasswordHash())
                .as("signing in must raise the stored cost without a further step")
                .contains("m=19456");
    }

    private UserAccount enabled(UserAccount account) {
        account.enable();
        return account;
    }
}
