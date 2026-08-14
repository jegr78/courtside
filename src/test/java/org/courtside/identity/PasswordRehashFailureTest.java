package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
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
    private UserDetailsPasswordService passwordService;

    @Autowired
    private PlatformTransactionManager transactionManager;

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
        UserAccount account = enabled(new UserAccount(
                new Person("John", "Roe", "john.roe@example.org"),
                "roe.john", weaklyHashedPassword(), Set.of(Role.MEMBER)));
        when(accounts.findByUsername("roe.john")).thenReturn(Optional.of(account));
        when(accounts.rehashPassword(any(), any(), any()))
                .thenThrow(new DataAccessResourceFailureException("read-only replica"));

        // when
        mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", "roe.john")
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk());

        // then
        verify(accounts).rehashPassword(eq(account.getId()), eq(account.getPasswordHash()), any());
    }

    @Test
    void givenAnActiveCallerTransaction_whenUpdatingThePassword_thenTheGuardedWriteRunsOutsideIt() {
        // given
        UserAccount account = enabled(new UserAccount(
                new Person("Mary", "Major", "mary.major@example.org"),
                "major.mary", weaklyHashedPassword(), Set.of(Role.MEMBER)));
        AtomicBoolean transactionActiveAtTheGuard = new AtomicBoolean(true);
        when(accounts.findByUsername("major.mary")).thenAnswer(invocation -> {
            transactionActiveAtTheGuard.set(TransactionSynchronizationManager.isActualTransactionActive());
            return Optional.of(account);
        });
        UserDetails user = User.withUsername("major.mary")
                .password(account.getPasswordHash())
                .authorities("ROLE_MEMBER")
                .build();

        // when
        new TransactionTemplate(transactionManager).executeWithoutResult(status ->
                passwordService.updatePassword(user, weaklyHashedPassword()));

        // then
        assertThat(transactionActiveAtTheGuard)
                .as("the caller's transaction must be suspended so the rehash guard holds no transaction")
                .isFalse();
    }

    private String weaklyHashedPassword() {
        return new Argon2PasswordEncoder(16, 32, 1, 16384, 2).encode(PASSWORD);
    }
}
