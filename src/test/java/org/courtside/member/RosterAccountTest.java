package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.testfixture.IdentityTestFixture;
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
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import jakarta.mail.internet.MimeMessage;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static java.util.concurrent.TimeUnit.SECONDS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Import(IdentityTestFixture.class)
class RosterAccountTest extends AbstractIntegrationTest {

    @MockitoSpyBean
    private JavaMailSender sender;

    private static final String SIGN_IN_PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;


    @Autowired
    private IdentityTestFixture identity;

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
        UUID person = identity.createPerson("John", "Roe", "john.roe@example.org");

        // when
        roster.createAccount(person, "roe.john", Set.of(Role.MEMBER));

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
        UUID person = identity.createPerson("John", "Roe", "john.roe@example.org");

        // when
        RosterService.RosterEntry entry = roster.createAccount(
                person, "roe.john", Set.of(Role.MEMBER, Role.TRAINER));

        // then
        assertThat(entry.personId()).isEqualTo(person);
        assertThat(entry.username()).isEqualTo("roe.john");
        assertThat(entry.accountId()).isEqualTo(accounts.findByUsername("roe.john").orElseThrow().getId());
        assertThat(entry.enabled()).isTrue();
        assertThat(entry.roles()).containsExactlyInAnyOrder(Role.MEMBER, Role.TRAINER);
    }

    @Test
    void givenATakenUsername_whenCreatingAnAccount_thenItIsRefusedByName() {
        // given
        UUID first = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID second = identity.createPerson("Mary", "Major", "mary.major@example.org");
        roster.createAccount(first, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.createAccount(
                second, "doe.jane", Set.of(Role.MEMBER)))
                .isInstanceOf(UsernameTakenException.class);
    }

    @Test
    void givenAPersonHoldingAnAccount_whenCreatingASecondOne_thenItIsRefused() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.createAccount(
                jane, "doe.jane.second", Set.of(Role.MEMBER)))
                .isInstanceOf(PersonAccountExistsException.class)
                .hasMessageContaining(jane.toString());
        assertThat(accounts.findByPersonIdIn(List.of(jane)))
                .as("the refused create must leave exactly the account that was already there")
                .singleElement()
                .satisfies(account -> assertThat(account.getUsername()).isEqualTo("doe.jane"));
    }

    @Test
    void givenAPersonTheClubHasNoAddressFor_whenCreatingAnAccount_thenItIsRefusedWithItsReason() {
        // given
        RosterService.RosterEntry mary = roster.createPerson("Mary", "Major", null);

        // when / then
        assertThatThrownBy(() -> roster.createAccount(
                mary.personId(), "major.mary", Set.of(Role.MEMBER)))
                .isInstanceOf(AccountAddressRequiredException.class)
                .extracting("code").isEqualTo("roster.account.addressMissing");
        assertThat(accounts.findByPersonIdIn(List.of(mary.personId()))).isEmpty();
    }

    @Test
    void givenAPersonWhoJustGainedAnAddress_whenCreatingAnAccount_thenItIsCreated() {
        // given
        RosterService.RosterEntry mary = roster.createPerson("Mary", "Major", null);
        roster.changePerson(mary.personId(), "Mary", "Major", "mary.major@example.org");

        // when
        RosterService.RosterEntry entry = roster.createAccount(
                mary.personId(), "major.mary", Set.of(Role.MEMBER));

        // then
        assertThat(entry.username()).isEqualTo("major.mary");
    }

    @Test
    void givenAPersonHoldingAnAccount_whenTakingTheirAddressAway_thenItIsRefusedWithItsReason() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.changePerson(jane, "Jane", "Doe", null))
                .isInstanceOf(AccountAddressRequiredException.class)
                .extracting("code").isEqualTo("roster.person.addressHeldByAccount");
        assertThat(roster.person(jane).email()).isEqualTo("jane.doe@example.org");
    }

    @Test
    void givenAPersonHoldingAnAccount_whenCorrectingTheirAddress_thenTheChangeIsAllowed() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry changed =
                roster.changePerson(jane, "Jane", "Doe", "jane.major@example.org");

        // then
        assertThat(changed.email()).isEqualTo("jane.major@example.org");
    }

    @Test
    void givenAnUnknownPerson_whenCreatingAnAccount_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000ff");

        // when / then
        assertThatThrownBy(() -> roster.createAccount(
                absent, "roe.john", Set.of(Role.MEMBER)))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAPersonWithoutAnAccount_whenChangingTheirRoles_thenItIsRefusedByType() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        assertThatThrownBy(() -> roster.changeRoles(jane, Set.of(Role.TRAINER)))
                .isInstanceOf(AccountNotFoundException.class)
                .hasMessageContaining(jane.toString());
    }

    @Test
    void givenAnAccount_whenItsRolesAreReplaced_thenTheRosterEntryCarriesTheNewOnes() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry =
                roster.changeRoles(jane, Set.of(Role.MEMBER, Role.TREASURER));

        // then
        assertThat(entry.roles()).containsExactlyInAnyOrder(Role.MEMBER, Role.TREASURER);
        assertThat(accounts.findByUsername("doe.jane").orElseThrow().getRoles())
                .containsExactlyInAnyOrder(Role.MEMBER, Role.TREASURER);
    }

    @Test
    void givenADisabledAccount_whenItIsEnabledAgain_thenTheRosterEntrySaysSo() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        roster.setAccountEnabled(jane, false);

        // when
        RosterService.RosterEntry entry = roster.setAccountEnabled(jane, true);

        // then
        assertThat(entry.enabled()).isTrue();
        assertThat(accounts.findByUsername("doe.jane").orElseThrow().isEnabled()).isTrue();
    }

    @Test
    void givenASignedInMember_whenTheirAccountIsDisabled_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());

        // when
        roster.setAccountEnabled(jane, false);

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInAdministrator_whenTheAdminRoleIsRemoved_thenTheAdminSurfaceRefusesThatSession()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER, Role.ADMIN));
        signInReadyAccount(mary, "major.mary", Set.of(Role.ADMIN));
        MockHttpSession session = signIn("doe.jane");
        mockMvc.perform(get("/api/admin/roster").session(session))
                .andExpect(status().isOk());

        // when
        roster.changeRoles(jane, Set.of(Role.MEMBER));

        // then
        mockMvc.perform(get("/api/admin/roster").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInMember_whenARoleIsOnlyAdded_thenTheirSessionStands() throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.changeRoles(jane, Set.of(Role.MEMBER, Role.TRAINER));

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenASignedInMember_whenTheirAlreadyEnabledAccountIsEnabled_thenTheirSessionStands()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.setAccountEnabled(jane, true);

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenAMistypedUsername_whenItIsCorrected_thenTheEntryAndTheAccountCarryTheNewOne() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jaen", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry = roster.changeUsername(jane, "doe.jane");

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
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry = roster.changeUsername(jane, "doe.jane");

        // then
        assertThat(entry.username()).isEqualTo("doe.jane");
        assertThat(accounts.findByUsername("doe.jane")).isPresent();
    }

    @Test
    void givenAUsernameAnotherAccountHolds_whenCorrectingIt_thenItIsRefusedByName() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        roster.createAccount(mary, "major.mary", Set.of(Role.MEMBER));

        // when / then
        UUID refused = accounts.findByUsername("major.mary").orElseThrow().getId();
        assertThatThrownBy(() -> roster.changeUsername(mary, "doe.jane"))
                .isInstanceOf(UsernameTakenException.class)
                .hasMessageContaining(refused.toString())
                .hasMessageNotContaining("doe.jane")
                .hasNoCause();
        assertThat(accounts.findByUsername("major.mary"))
                .as("the refused correction must leave the account under the name it had")
                .isPresent();
    }

    @Test
    void givenAPersonWithoutAnAccount_whenCorrectingTheUsername_thenItIsRefusedByType() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        assertThatThrownBy(() -> roster.changeUsername(jane, "doe.jane"))
                .isInstanceOf(AccountNotFoundException.class)
                .hasMessageContaining(jane.toString());
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
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        roster.createAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when / then
        assertThatThrownBy(() -> roster.changeUsername(jane, "   "))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("blank");
        assertThat(accounts.findByUsername("doe.jane")).isPresent();
    }

    @Test
    void givenASignedInMember_whenTheirUsernameIsCorrected_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jaen", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jaen");
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());

        // when
        roster.changeUsername(jane, "doe.jane");

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenARenamedAccount_whenANewOneTakesTheNameItGaveUp_thenTheOldSessionIsStillRefused()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jaen", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jaen");

        // when
        roster.changeUsername(jane, "doe.jane");
        UUID mary = identity.createPerson("Mary", "Major", "mary.major@example.org");
        roster.createAccount(mary, "doe.jaen", Set.of(Role.MEMBER));

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInMember_whenTheUsernameIsSetToTheOneTheyAlreadyHold_thenTheirSessionStands()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.changeUsername(jane, "doe.jane");

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenAMemberWhoAlreadyReplacedTheirPassword_whenItIsRequestedAgain_thenTheirOwnOneIsGone() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));

        // when
        RosterService.RosterEntry entry = roster.requestCredentials(jane);

        // then
        assertThat(entry.username()).isEqualTo("doe.jane");
        UserAccount stored = awaitIssuedCredential("doe.jane");
        assertThat(stored.isPasswordChangeRequired()).isTrue();
        assertThat(passwordEncoder.matches(SIGN_IN_PASSWORD, stored.getPasswordHash()))
                .as("the credential the member could sign in with must be gone")
                .isFalse();
    }

    @Test
    void givenASignedInMember_whenACredentialIsRequestedForThem_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());

        // when
        roster.requestCredentials(jane);
        awaitIssuedCredential("doe.jane");

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenAPersonWithoutAnAccount_whenResettingThePassword_thenItIsRefusedByType() {
        // given
        UUID jane = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // when / then
        assertThatThrownBy(() -> roster.requestCredentials(jane))
                .isInstanceOf(AccountNotFoundException.class)
                .hasMessageContaining(jane.toString());
    }

    @Test
    void givenAnUnknownPerson_whenResettingThePassword_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fd");

        // when / then
        assertThatThrownBy(() -> roster.requestCredentials(absent))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    // The credential is issued by the listener that sends it, so the account is read back once the
    // message has been handed over rather than at the moment the board asked for it.
    private UserAccount awaitIssuedCredential(String username) {
        verify(sender, timeout(SECONDS.toMillis(10)).atLeastOnce()).send(any(MimeMessage.class));
        return accounts.findByUsername(username).orElseThrow();
    }

    private void signInReadyAccount(UUID personId, String username, Set<Role> roles) {
        identity.createEnabledAccount(
                personId, username, passwordEncoder.encode(SIGN_IN_PASSWORD), roles);
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
