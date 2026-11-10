package org.courtside.identity;

import jakarta.servlet.http.Cookie;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.courtside.identity.AccountFixtures.enabled;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DisplacedSessionDeletionFailureTest extends AbstractIntegrationTest {

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private SessionRepositoryFilter<?> storedSessions;
    @Autowired
    private PersonRepository persons;
    @Autowired
    private UserAccountRepository accounts;
    @Autowired
    private PasswordEncoder passwordEncoder;

    @MockitoSpyBean
    private JdbcIndexedSessionRepository sessions;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(storedSessions)
                .apply(springSecurity())
                .build();
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(
                jane, "doe.jane", passwordEncoder.encode("correct-horse"), Set.of(Role.ADMIN), "de")));
    }

    // Section 10 says a store that refuses a deletion must not fail the operation that caused it.
    // Here that operation is a member's sign-in, and the bound is what gives way instead.
    @Test
    void givenTheStoreRefusesTheDeletion_whenTheAccountSignsInPastItsLimit_thenTheSignInStillCarries()
            throws Exception {
        // given
        for (int index = 0; index < 5; index++) {
            signedIn();
        }
        doThrow(new DataAccessResourceFailureException("the store refused"))
                .when(sessions).deleteById(anyString());

        // when
        Cookie sixth = signedIn();

        // then
        mockMvc.perform(get("/api/admin/config").cookie(sixth)).andExpect(status().isOk());
    }

    private Cookie signedIn() throws Exception {
        Cookie session = mockMvc.perform(post("/api/session")
                        .param("username", "doe.jane")
                        .param("password", "correct-horse")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("SESSION");
        assertThat(session).isNotNull();
        return session;
    }
}
