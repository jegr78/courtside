package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.Set;
import java.util.stream.Stream;

import static org.courtside.identity.AccountFixtures.enabled;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class SessionProfileTest extends AbstractIntegrationTest {

    @Autowired private WebApplicationContext context;
    @Autowired private PersonRepository persons;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private JdbcClient jdbc;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @ParameterizedTest
    @MethodSource("assignedRoles")
    void givenAnAccountWithAssignedRoles_whenReadingItsSession_thenItsOwnNamePartsAndExactRolesAreReturned(
            Set<Role> roles) throws Exception {
        // given
        MockHttpSession session = signIn(roles);

        // when / then
        mvc.perform(get("/api/session").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.username").value("doe.jane"))
                .andExpect(jsonPath("$.firstName").value("Jane Mary"))
                .andExpect(jsonPath("$.lastName").value("Doe Roe"))
                .andExpect(jsonPath("$.displayName").value("Jane Mary Doe Roe"))
                .andExpect(jsonPath("$.roles").value(containsInAnyOrder(roles.stream().map(Role::name).toArray(String[]::new))));
    }

    @Test
    void givenNoAccountSession_whenReadingTheSession_thenNoIdentityValuesAreExposed() throws Exception {
        // when / then
        mvc.perform(get("/api/session"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.username").doesNotExist())
                .andExpect(jsonPath("$.firstName").doesNotExist())
                .andExpect(jsonPath("$.lastName").doesNotExist())
                .andExpect(jsonPath("$.displayName").doesNotExist())
                .andExpect(jsonPath("$.roles").isEmpty());
    }

    @Test
    void givenARevokedAccountSession_whenReadingTheSession_thenThePreviousIdentityIsAbsent() throws Exception {
        // given
        MockHttpSession session = signIn(Set.of(Role.MEMBER));
        jdbc.sql("UPDATE user_account SET security_epoch = security_epoch + 1 WHERE username = 'doe.jane'").update();

        // when / then
        mvc.perform(get("/api/session").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.username").doesNotExist())
                .andExpect(jsonPath("$.firstName").doesNotExist())
                .andExpect(jsonPath("$.lastName").doesNotExist())
                .andExpect(jsonPath("$.displayName").doesNotExist())
                .andExpect(jsonPath("$.roles").isEmpty());
    }

    private MockHttpSession signIn(Set<Role> roles) throws Exception {
        Person person = persons.save(new Person("Jane Mary", "Doe Roe", "jane.doe@example.org"));
        accounts.save(enabled(new UserAccount(person, "doe.jane", passwords.encode("correct-horse"), roles, "en")));
        return (MockHttpSession) mvc.perform(post("/api/session").with(csrf())
                        .param("username", "doe.jane").param("password", "correct-horse"))
                .andExpect(status().isOk()).andReturn().getRequest().getSession(false);
    }

    private static Stream<Set<Role>> assignedRoles() {
        return Stream.of(Set.of(Role.MEMBER), Set.of(Role.TRAINER, Role.TREASURER), Set.of());
    }
}
