package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.MembershipType;
import org.courtside.member.internal.MembershipTypeInactiveException;
import org.courtside.member.internal.MembershipTypeNotFoundException;
import org.courtside.member.internal.PersonNotFoundException;
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

class MembershipAssignmentTest extends AbstractIntegrationTest {

    private static final String SIGN_IN_PASSWORD = "correct-horse-battery-staple";

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    @Autowired
    private MemberService memberships;

    @Autowired
    private RosterService roster;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void givenAPersonWithoutAMembership_whenOneIsAssigned_thenTheRosterEntryCarriesIt() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when
        RosterService.RosterEntry entry = roster.assignMembership(mary.getId(), type.getId());

        // then
        assertThat(entry.membershipTypeId()).isEqualTo(type.getId());
        assertThat(memberships.membershipTypeIdOf(mary.getId())).contains(type.getId());
    }

    @Test
    void givenAnInactiveMembershipType_whenAssigningIt_thenItIsRefusedAndNothingIsWritten() {
        // given
        MembershipType type = memberships.createMembershipType("Passive", null);
        memberships.setMembershipTypeActive(type.getId(), false);
        Person richard = persons.save(new Person("Richard", "Miles", "richard.miles@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.assignMembership(richard.getId(), type.getId()))
                .isInstanceOf(MembershipTypeInactiveException.class);
        assertThat(members.findByPersonId(richard.getId())).isEmpty();
    }

    @Test
    void givenAMembershipOnATypeThatIsLaterDeactivated_whenReadingIt_thenItStillHolds() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.assignMembership(mary.getId(), type.getId());

        // when
        memberships.setMembershipTypeActive(type.getId(), false);

        // then — deactivating a type must stop the next assignment, not strip the people on it
        assertThat(memberships.membershipTypeIdOf(mary.getId())).contains(type.getId());
    }

    @Test
    void givenAPersonOnTheWrongType_whenAnotherIsAssigned_thenTheirOneMembershipMoves() {
        // given
        MembershipType wrong = memberships.createMembershipType("Junior", null);
        MembershipType right = memberships.createMembershipType("Senior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.assignMembership(mary.getId(), wrong.getId());

        // when — one membership per person, so a correction has to move the row it already has
        RosterService.RosterEntry entry = roster.assignMembership(mary.getId(), right.getId());

        // then
        assertThat(entry.membershipTypeId()).isEqualTo(right.getId());
        assertThat(members.findByPersonIdIn(List.of(mary.getId())))
                .singleElement()
                .satisfies(member ->
                        assertThat(member.getMembershipTypeId()).isEqualTo(right.getId()));
    }

    @Test
    void givenTheTypeAPersonAlreadyHolds_whenAssigningItAgain_thenTheEntryStillCarriesIt() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.assignMembership(mary.getId(), type.getId());

        // when
        RosterService.RosterEntry entry = roster.assignMembership(mary.getId(), type.getId());

        // then — the unique person index would answer the member's own row, so this must not
        // become a conflict with itself
        assertThat(entry.membershipTypeId()).isEqualTo(type.getId());
        assertThat(members.findByPersonIdIn(List.of(mary.getId()))).hasSize(1);
    }

    @Test
    void givenAnUnknownPerson_whenAssigningAMembership_thenTheFailureNamesWhatWasNotFound() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fc");

        // when / then
        assertThatThrownBy(() -> roster.assignMembership(absent, type.getId()))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAnUnknownMembershipType_whenAssigningIt_thenTheFailureNamesWhatWasNotFound() {
        // given
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fb");

        // when / then
        assertThatThrownBy(() -> roster.assignMembership(mary.getId(), absent))
                .isInstanceOf(MembershipTypeNotFoundException.class)
                .hasMessageContaining(absent.toString());
        assertThat(members.findByPersonId(mary.getId())).isEmpty();
    }

    @Test
    void givenNoMembershipType_whenAssigningOne_thenTheServiceRefusesItsOwnCaller() {
        // given — the contract rejects this at the edge, so one reaching the service means a
        // caller skipped the validation that precedes it
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.assignMembership(mary.getId(), null))
                .isInstanceOf(IllegalStateException.class);
        assertThat(members.findByPersonId(mary.getId())).isEmpty();
    }

    @Test
    void givenAMembership_whenItIsRemoved_thenThePersonHoldsNone() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.assignMembership(mary.getId(), type.getId());

        // when
        roster.removeMembership(mary.getId());

        // then
        assertThat(memberships.membershipTypeIdOf(mary.getId())).isEmpty();
        assertThat(persons.findById(mary.getId()))
                .as("only the membership goes; the person stays")
                .isPresent();
    }

    @Test
    void givenAPersonWithoutAMembership_whenRemovingIt_thenItIsTheStateTheRequestAsksFor() {
        // given
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when
        roster.removeMembership(mary.getId());

        // then
        assertThat(memberships.membershipTypeIdOf(mary.getId())).isEmpty();
    }

    @Test
    void givenAnUnknownPerson_whenRemovingAMembership_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fa");

        // when / then
        assertThatThrownBy(() -> roster.removeMembership(absent))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAPersonWithoutAnAccount_whenAssigningAMembership_thenThereIsNoSessionToEnd() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when
        RosterService.RosterEntry entry = roster.assignMembership(mary.getId(), type.getId());

        // then
        assertThat(entry.accountId()).isNull();
        assertThat(entry.membershipTypeId()).isEqualTo(type.getId());
    }

    @Test
    void givenASignedInMember_whenTheyAreGivenAMembership_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());

        // when
        roster.assignMembership(jane.getId(), type.getId());

        // then — the membership decides which rules the account's bookings are measured
        // against, so it may not keep booking under the ones it signed in with
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInMember_whenTheirMembershipIsRemoved_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        roster.assignMembership(jane.getId(), type.getId());
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.removeMembership(jane.getId());

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInMember_whenTheTypeTheyAlreadyHoldIsWrittenAgain_thenTheirSessionStands()
            throws Exception {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        roster.assignMembership(jane.getId(), type.getId());
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.assignMembership(jane.getId(), type.getId());

        // then — nothing changed, so signing everybody out would be a cost without a reason
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenASignedInMemberWithoutAMembership_whenRemovingOne_thenTheirSessionStands()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.removeMembership(jane.getId());

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
