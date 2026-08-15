package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PasswordRehashGuardTest extends AbstractIntegrationTest {

    private static final String PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private UserDetailsPasswordService passwordService;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @MockitoBean
    private UserAccountRepository accounts;

    @MockitoBean
    private PasswordRehashRepository rehashRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenTheRehashWriteFails_whenTheMemberSignsIn_thenTheLoginStillSucceeds() throws Exception {
        // given
        UserAccount account = member("roe.john", new Person("John", "Roe", "john.roe@example.org"));
        when(accounts.findByUsername("roe.john")).thenReturn(Optional.of(account));
        when(rehashRepository.rehashPassword(any(), any(), any()))
                .thenThrow(new DataAccessResourceFailureException("read-only replica"));

        // when
        mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", "roe.john")
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk());

        // then
        verify(rehashRepository).rehashPassword(eq(account.getId()), eq(account.getPasswordHash()), any());
    }

    @Test
    void givenTheRehashLookupFails_whenTheMemberSignsIn_thenTheLoginStillSucceeds() throws Exception {
        // given
        UserAccount account = member("miles.richard",
                new Person("Richard", "Miles", "richard.miles@example.org"));
        when(accounts.findByUsername("miles.richard"))
                .thenReturn(Optional.of(account))
                .thenThrow(new DataAccessResourceFailureException("connection pool exhausted"));

        // when
        mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", "miles.richard")
                        .param("password", PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk());

        // then
        verify(rehashRepository, never()).rehashPassword(any(), any(), any());
    }

    @Test
    void givenAnActiveCallerTransaction_whenUpdatingThePassword_thenTheGuardHoldsNoTransaction() {
        // given
        UserAccount account = member("major.mary", new Person("Mary", "Major", "mary.major@example.org"));
        String hashAtTheCurrentCost = passwordEncoder.encode(PASSWORD);
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
                passwordService.updatePassword(user, hashAtTheCurrentCost));

        // then
        assertThat(transactionActiveAtTheGuard)
                .as("the caller's transaction must be suspended so the rehash guard holds no transaction")
                .isFalse();
    }

    private UserAccount member(String username, Person person) {
        UserAccount account = new UserAccount(person, username, weaklyHashedPassword(), Set.of(Role.MEMBER));
        account.enable();
        return account;
    }

    private String weaklyHashedPassword() {
        return new Argon2PasswordEncoder(16, 32, 1, 16384, 2).encode(PASSWORD);
    }
}
