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

import java.time.LocalDate;
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
        RosterService.RosterEntry entry = roster.writeMembership(mary.getId(), type.getId(), MembershipPeriod.running());

        // then
        assertThat(entry.membership().typeId()).isEqualTo(type.getId());
        assertThat(memberships.membershipTypeIdOf(mary.getId())).contains(type.getId());
    }

    @Test
    void givenAnInactiveMembershipType_whenAssigningIt_thenItIsRefusedAndNothingIsWritten() {
        // given
        MembershipType type = memberships.createMembershipType("Passive", null);
        memberships.setMembershipTypeActive(type.getId(), false);
        Person richard = persons.save(new Person("Richard", "Miles", "richard.miles@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(richard.getId(), type.getId(), MembershipPeriod.running()))
                .isInstanceOf(MembershipTypeInactiveException.class);
        assertThat(members.findByPersonId(richard.getId())).isEmpty();
    }

    @Test
    void givenAMembershipOnATypeThatIsLaterDeactivated_whenReadingIt_thenItStillHolds() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.writeMembership(mary.getId(), type.getId(), MembershipPeriod.running());

        // when
        memberships.setMembershipTypeActive(type.getId(), false);

        // then
        assertThat(memberships.membershipTypeIdOf(mary.getId())).contains(type.getId());
    }

    @Test
    void givenAPersonOnTheWrongType_whenAnotherIsAssigned_thenTheirOneMembershipMoves() {
        // given
        MembershipType wrong = memberships.createMembershipType("Junior", null);
        MembershipType right = memberships.createMembershipType("Senior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.writeMembership(mary.getId(), wrong.getId(), MembershipPeriod.running());

        // when
        RosterService.RosterEntry entry = roster.writeMembership(mary.getId(), right.getId(), MembershipPeriod.running());

        // then
        assertThat(entry.membership().typeId()).isEqualTo(right.getId());
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
        roster.writeMembership(mary.getId(), type.getId(), MembershipPeriod.running());

        // when
        RosterService.RosterEntry entry = roster.writeMembership(mary.getId(), type.getId(), MembershipPeriod.running());

        // then
        assertThat(entry.membership().typeId()).isEqualTo(type.getId());
        assertThat(members.findByPersonIdIn(List.of(mary.getId()))).hasSize(1);
    }

    @Test
    void givenAnUnknownPerson_whenAssigningAMembership_thenTheFailureNamesWhatWasNotFound() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fc");

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(absent, type.getId(), MembershipPeriod.running()))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAnUnknownMembershipType_whenAssigningIt_thenTheFailureNamesWhatWasNotFound() {
        // given
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fb");

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(mary.getId(), absent, MembershipPeriod.running()))
                .isInstanceOf(MembershipTypeNotFoundException.class)
                .hasMessageContaining(absent.toString());
        assertThat(members.findByPersonId(mary.getId())).isEmpty();
    }

    @Test
    void givenNoMembershipType_whenAssigningOne_thenTheServiceRefusesItsOwnCaller() {
        // given
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when / then
        assertThatThrownBy(() -> roster.writeMembership(mary.getId(), null, MembershipPeriod.running()))
                .isInstanceOf(IllegalStateException.class);
        assertThat(members.findByPersonId(mary.getId())).isEmpty();
    }

    @Test
    void givenAMembership_whenItIsEnded_thenThePersonHoldsNoneAndTheRecordStays() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));
        roster.writeMembership(mary.getId(), type.getId(), MembershipPeriod.running());

        // when
        roster.endMembership(mary.getId());

        // then
        assertThat(memberships.membershipTypeIdOf(mary.getId())).isEmpty();
        assertThat(persons.findById(mary.getId()))
                .as("only the membership goes; the person stays")
                .isPresent();
        assertThat(members.findByPersonId(mary.getId()))
                .as("and so does the record of what they held")
                .isPresent();
    }

    @Test
    void givenAPersonWithoutAMembership_whenEndingIt_thenItIsTheStateTheRequestAsksFor() {
        // given
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when
        roster.endMembership(mary.getId());

        // then
        assertThat(memberships.membershipTypeIdOf(mary.getId())).isEmpty();
    }

    @Test
    void givenAnUnknownPerson_whenEndingAMembership_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000fa");

        // when / then
        assertThatThrownBy(() -> roster.endMembership(absent))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAPersonWithoutAnAccount_whenAssigningAMembership_thenThereIsNoSessionToEnd() {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person mary = persons.save(new Person("Mary", "Major", "mary.major@example.org"));

        // when
        RosterService.RosterEntry entry = roster.writeMembership(mary.getId(), type.getId(), MembershipPeriod.running());

        // then
        assertThat(entry.accountId()).isNull();
        assertThat(entry.membership().typeId()).isEqualTo(type.getId());
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
        roster.writeMembership(jane.getId(), type.getId(), MembershipPeriod.running());

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenAPersonHoldingTwoAccounts_whenTheirMembershipChanges_thenBothSessionsAreRefused()
            throws Exception {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        signInReadyAccount(jane, "doe.jane.second", Set.of(Role.MEMBER));
        MockHttpSession first = signIn("doe.jane");
        MockHttpSession second = signIn("doe.jane.second");

        // when
        roster.writeMembership(jane.getId(), type.getId(), MembershipPeriod.running());

        // then
        mockMvc.perform(get("/api/my/bookings").session(first))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
        mockMvc.perform(get("/api/my/bookings").session(second))
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
        roster.writeMembership(jane.getId(), type.getId(), MembershipPeriod.running());
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.endMembership(jane.getId());

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
        roster.writeMembership(jane.getId(), type.getId(), MembershipPeriod.running());
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.writeMembership(jane.getId(), type.getId(), MembershipPeriod.running());

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenASignedInMember_whenOnlyTheDateTheirMembershipBeganIsCorrected_thenTheirSessionStands()
            throws Exception {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        roster.writeMembership(jane.getId(), type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.writeMembership(jane.getId(), type.getId(), new MembershipPeriod(LocalDate.of(2020, 9, 1), null));

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isOk());
    }

    @Test
    void givenASignedInMemberWhoseMembershipEnded_whenItIsRevived_thenTheirNextRequestIsRefused()
            throws Exception {
        // given
        MembershipType type = memberships.createMembershipType("Junior", null);
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        roster.writeMembership(jane.getId(), type.getId(),
                new MembershipPeriod(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31)));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.writeMembership(jane.getId(), type.getId(), new MembershipPeriod(LocalDate.of(2026, 1, 1), null));

        // then
        mockMvc.perform(get("/api/my/bookings").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:unauthenticated"));
    }

    @Test
    void givenASignedInMemberWithoutAMembership_whenRemovingOne_thenTheirSessionStands()
            throws Exception {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        signInReadyAccount(jane, "doe.jane", Set.of(Role.MEMBER));
        MockHttpSession session = signIn("doe.jane");

        // when
        roster.endMembership(jane.getId());

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
