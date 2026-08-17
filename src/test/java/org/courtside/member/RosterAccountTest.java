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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
        // given — a successor, because an instance never gives up its last administrator
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.ADMIN));
        signInReadyAccount(mary, "major.mary", Set.of(Role.ADMIN));
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

    @Test
    void givenAMistypedUsername_whenItIsCorrected_thenTheEntryAndTheAccountCarryTheNewOne() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        roster.createAccount(jane.getId(), "doe.jaen", "one-time-password", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry = roster.changeUsername(jane.getId(), "doe.jane");

        // then
        assertThat(entry.username()).isEqualTo("doe.jane");
        assertThat(entry.roles()).containsExactly(Role.MEMBER);
        assertThat(entry.enabled()).isTrue();
        assertThat(accounts.findByUsername("doe.jaen")).isEmpty();
        assertThat(accounts.findByUsername("doe.jane")).isPresent();
    }

    @Test
    void givenTheUsernameAnAccountAlreadyHolds_whenCorrectingIt_thenNothingChanges() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        roster.createAccount(jane.getId(), "doe.jane", "one-time-password", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry = roster.changeUsername(jane.getId(), "doe.jane");

        // then — the unique index would answer the account's own row, so this must not become a
        // conflict with itself
        assertThat(entry.username()).isEqualTo("doe.jane");
        assertThat(accounts.findByUsername("doe.jane")).isPresent();
    }

    @Test
    void givenAUsernameAnotherAccountHolds_whenCorrectingIt_thenItIsRefusedByName() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.createAccount(jane.getId(), "doe.jane", "one-time-password", Set.of(Role.MEMBER));
        roster.createAccount(mary.getId(), "major.mary", "another-password", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.changeUsername(mary.getId(), "doe.jane"))
                .isInstanceOf(UsernameTakenException.class)
                .hasMessageContaining("doe.jane");
        assertThat(accounts.findByUsername("major.mary"))
                .as("the refused correction must leave the account under the name it had")
                .isPresent();
    }

    @Test
    void givenAPersonWithoutAnAccount_whenCorrectingTheUsername_thenItIsRefusedByType() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.changeUsername(jane.getId(), "doe.jane"))
                .isInstanceOf(AccountNotFoundException.class)
                .hasMessageContaining(jane.getId().toString());
    }

    @Test
    void givenAnUnknownPerson_whenCorrectingTheUsername_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fe");

        // when / then
        assertThatThrownBy(() -> roster.changeUsername(absent, "doe.jane"))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenABlankUsername_whenCorrectingIt_thenTheServiceRefusesItsOwnCaller() {
        // given — the contract rejects this at the edge, so one reaching the service means a
        // caller skipped the validation that precedes it
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        roster.createAccount(jane.getId(), "doe.jane", "one-time-password", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.changeUsername(jane.getId(), "   "))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("blank");
        assertThat(accounts.findByUsername("doe.jane")).isPresent();
    }

    @Test
    void givenASignedInMember_whenTheirUsernameIsCorrected_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jaen", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jaen");
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());

        // when
        roster.changeUsername(jane.getId(), "doe.jane");

        // then — a session is recognised by the name it was signed in with, so one left standing
        // would be signed in under a name the instance no longer knows
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenARenamedAccount_whenANewOneTakesTheNameItGaveUp_thenTheOldSessionIsStillRefused()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jaen", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jaen");

        // when — correcting a username is the only way a name is ever given up, and handing it
        // to somebody else is what a board does after mixing two members up
        roster.changeUsername(jane.getId(), "doe.jane");
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.createAccount(mary.getId(), "doe.jaen", "one-time-password", Set.of(Role.MEMBER));

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInMember_whenTheUsernameIsSetToTheOneTheyAlreadyHold_thenTheirSessionStands()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.changeUsername(jane.getId(), "doe.jane");

        // then — nothing was taken away, so signing everybody out would be a cost without a reason
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenAMemberWhoAlreadyReplacedTheirPassword_whenItIsReset_thenOnlyTheNewOneIsLeft() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry = roster.resetPassword(jane.getId(), "second-one-time-password");

        // then
        assertThat(entry.username()).isEqualTo("doe.jane");
        UserAccount stored = accounts.findByUsername("doe.jane").orElseThrow();
        assertThat(stored.isPasswordChangeRequired()).isTrue();
        assertThat(stored.getPasswordHash())
                .as("the new one-time password must never be stored as given")
                .isNotEqualTo("second-one-time-password");
        assertThat(passwordEncoder.matches("second-one-time-password", stored.getPasswordHash())).isTrue();
        assertThat(passwordEncoder.matches(SIGN_IN_PASSWORD, stored.getPasswordHash()))
                .as("the credential the member could sign in with must be gone")
                .isFalse();
    }

    @Test
    void givenASignedInMember_whenTheirPasswordIsReset_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());

        // when
        roster.resetPassword(jane.getId(), "second-one-time-password");

        // then — the credential the session was opened with no longer exists
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenAnAccountWhosePasswordWasReset_whenSigningInWithTheNewOne_thenItIsAccepted()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        roster.resetPassword(jane.getId(), "second-one-time-password");

        // then — the reset is the remedy for a member who cannot sign in, so the password it
        // hands out has to be the one that works
        mockMvc.perform(post("/api/session")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("username", "doe.jane")
                        .param("password", "second-one-time-password")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Courtside-Password-Change-Required", "true"));
    }

    @Test
    void givenAPersonWithoutAnAccount_whenResettingThePassword_thenItIsRefusedByType() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.resetPassword(jane.getId(), "second-one-time-password"))
                .isInstanceOf(AccountNotFoundException.class)
                .hasMessageContaining(jane.getId().toString());
    }

    @Test
    void givenAnUnknownPerson_whenResettingThePassword_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fd");

        // when / then
        assertThatThrownBy(() -> roster.resetPassword(absent, "second-one-time-password"))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAPasswordShorterThanTheBootstrapFloor_whenResettingIt_thenTheServiceRefusesItsOwnCaller() {
        // given — the contract rejects this at the edge, so one reaching the service means a
        // caller skipped the validation that precedes it
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.resetPassword(jane.getId(), "eleven.char"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("12");
        assertThat(passwordEncoder.matches(SIGN_IN_PASSWORD,
                accounts.findByUsername("doe.jane").orElseThrow().getPasswordHash())).isTrue();
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
