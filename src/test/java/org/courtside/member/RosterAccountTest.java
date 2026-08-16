package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.AccountNotFoundException;
import org.courtside.member.internal.PersonAccountExistsException;
import org.courtside.member.internal.PersonNotFoundException;
import org.courtside.member.internal.UsernameTakenException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class RosterAccountTest extends AbstractIntegrationTest {

    private static final String SIGN_IN_PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private RosterService roster;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenANewAccount_whenItIsCreated_thenTheMemberMustReplaceThePasswordBeforeAnythingElse() {
        // given
        Person person = persons.save(new Person("John", "Roe", "john.roe@example.org"));

        // when
        roster.createAccount(person.getId(), "roe.john", "one-time-password", Set.of(Role.MEMBER));

        // then
        UserAccount stored = accounts.findByUsername("roe.john").orElseThrow();
        assertThat(stored.isPasswordChangeRequired()).isTrue();
        assertThat(stored.isEnabled()).isTrue();
        assertThat(stored.getPasswordHash())
                .as("the one-time password must never be stored as given")
                .isNotEqualTo("one-time-password");
    }

    @Test
    void givenANewAccount_whenItIsCreated_thenTheRosterEntryCarriesIt() {
        // given
        Person person = persons.save(new Person("John", "Roe", "john.roe@example.org"));

        // when
        RosterService.RosterEntry entry = roster.createAccount(
                person.getId(), "roe.john", "one-time-password", Set.of(Role.MEMBER, Role.TRAINER));

        // then
        assertThat(entry.personId()).isEqualTo(person.getId());
        assertThat(entry.username()).isEqualTo("roe.john");
        assertThat(entry.accountId()).isEqualTo(accounts.findByUsername("roe.john").orElseThrow().getId());
        assertThat(entry.enabled()).isTrue();
        assertThat(entry.roles()).containsExactlyInAnyOrder(Role.MEMBER, Role.TRAINER);
    }

    @Test
    void givenATakenUsername_whenCreatingAnAccount_thenItIsRefusedByName() {
        // given
        Person first = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        Person second = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.createAccount(first.getId(), "doe.jane", "one-time-password", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.createAccount(
                second.getId(), "doe.jane", "another-password", Set.of(Role.MEMBER)))
                .isInstanceOf(UsernameTakenException.class);
    }

    @Test
    void givenAPersonHoldingAnAccount_whenCreatingASecondOne_thenItIsRefused() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        roster.createAccount(jane.getId(), "doe.jane", "one-time-password", Set.of(Role.MEMBER));

        // when / then — every write here names an account by its person, so a second account
        // would be one this surface can neither show nor disable
        assertThatThrownBy(() -> roster.createAccount(
                jane.getId(), "doe.jane.second", "another-password", Set.of(Role.MEMBER)))
                .isInstanceOf(PersonAccountExistsException.class)
                .hasMessageContaining(jane.getId().toString());
        assertThat(accounts.findByPersonIdIn(List.of(jane.getId())))
                .as("the refused create must leave exactly the account that was already there")
                .singleElement()
                .satisfies(account -> assertThat(account.getUsername()).isEqualTo("doe.jane"));
    }

    @Test
    void givenAnUnknownPerson_whenCreatingAnAccount_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000ff");

        // when / then
        assertThatThrownBy(() -> roster.createAccount(
                absent, "roe.john", "one-time-password", Set.of(Role.MEMBER)))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAPasswordShorterThanTheBootstrapFloor_whenCreatingAnAccount_thenTheServiceRefusesItsOwnCaller() {
        // given — the contract rejects this at the edge, so one reaching the service means a
        // caller skipped the validation that precedes it
        Person person = persons.save(new Person("John", "Roe", "john.roe@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.createAccount(
                person.getId(), "roe.john", "eleven.char", Set.of(Role.MEMBER)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("12");
        assertThat(accounts.findByUsername("roe.john")).isEmpty();
    }

    @Test
    void givenAPersonWithoutAnAccount_whenChangingTheirRoles_thenItIsRefusedByType() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.changeRoles(jane.getId(), Set.of(Role.TRAINER)))
                .isInstanceOf(AccountNotFoundException.class)
                .hasMessageContaining(jane.getId().toString());
    }

    @Test
    void givenAnAccount_whenItsRolesAreReplaced_thenTheRosterEntryCarriesTheNewOnes() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        roster.createAccount(jane.getId(), "doe.jane", "one-time-password", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry =
                roster.changeRoles(jane.getId(), Set.of(Role.MEMBER, Role.TREASURER));

        // then
        assertThat(entry.roles()).containsExactlyInAnyOrder(Role.MEMBER, Role.TREASURER);
        assertThat(accounts.findByUsername("doe.jane").orElseThrow().getRoles())
                .containsExactlyInAnyOrder(Role.MEMBER, Role.TREASURER);
    }

    @Test
    void givenADisabledAccount_whenItIsEnabledAgain_thenTheRosterEntrySaysSo() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        roster.createAccount(jane.getId(), "doe.jane", "one-time-password", Set.of(Role.MEMBER));
        roster.setAccountEnabled(jane.getId(), false);

        // when
        RosterService.RosterEntry entry = roster.setAccountEnabled(jane.getId(), true);

        // then
        assertThat(entry.enabled()).isTrue();
        assertThat(accounts.findByUsername("doe.jane").orElseThrow().isEnabled()).isTrue();
    }

    @Test
    void givenASignedInMember_whenTheirAccountIsDisabled_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());

        // when
        roster.setAccountEnabled(jane.getId(), false);

        // then — the roles a session carries were read at sign-in, so a disable that waited for
        // the session to expire would not be a disable
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInAdministrator_whenTheAdminRoleIsRemoved_thenTheAdminSurfaceRefusesThatSession()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.ADMIN));
        MockHttpSession session = signIn("doe.jane");
        mockMvc.perform(get("/api/admin/roster").session(session))
                .andExpect(status().isOk());

        // when
        roster.changeRoles(jane.getId(), Set.of(Role.MEMBER));

        // then
        mockMvc.perform(get("/api/admin/roster").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInMember_whenARoleIsOnlyAdded_thenTheirSessionStands() throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.changeRoles(jane.getId(), Set.of(Role.MEMBER, Role.TRAINER));

        // then — nothing was taken away, so signing everybody out would be a cost without a reason
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenASignedInMember_whenTheirAlreadyEnabledAccountIsEnabled_thenTheirSessionStands()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.setAccountEnabled(jane.getId(), true);

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    private void signInReadyAccount(Person person, String username, Set<Role> roles) {
        UserAccount account = new UserAccount(
                person, username, passwordEncoder.encode(SIGN_IN_PASSWORD), roles);
        account.enable();
        accounts.save(account);
    }

    private MockHttpSession signIn(String username) throws Exception {
        return (MockHttpSession) mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", username)
                        .param("password", SIGN_IN_PASSWORD)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andReturn().getRequest().getSession(false);
    }
}
