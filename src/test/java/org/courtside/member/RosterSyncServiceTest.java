package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.facility.testfixture.FacilityTestFixture;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.card.CardService;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.courtside.identity.Role;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.member.MemberFixtures.memberSince;

@Import({FacilityTestFixture.class, IdentityTestFixture.class})
class RosterSyncServiceTest extends AbstractIntegrationTest {

    private static final UUID STANDARD_MEMBERSHIP =
            UUID.fromString("cccccccc-0000-0000-0000-000000000001");
    private static final Instant SIX_PM = Instant.parse("2026-05-13T16:00:00Z");
    private static final Instant SEVEN_PM = Instant.parse("2026-05-13T17:00:00Z");

    @Autowired
    private RosterSyncService sync;

    @Autowired
    private PersonRepository persons;

    @Autowired
    private IdentityTestFixture identity;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    @Autowired
    private CardService cards;

    @Autowired
    private FacilityTestFixture facilityFixture;

    @Autowired
    private BookingService bookings;

    private UUID courtId;
    private UUID memberOnlyCardId;

    @BeforeEach
    void setUp() {
        courtId = facilityFixture.createCourt(1, "Court 1");
        for (DayOfWeek day : DayOfWeek.values()) {
            facilityFixture.setOpeningHours(day, new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0)));
        }
        memberOnlyCardId = cards.createCard("Members only", "#B85C38",
                Set.of(Role.MEMBER), Set.of(), new short[]{}, false, false, false).getId();
    }

    @Test
    void givenAnAccountWhoseOnlyRoleWasMember_whenTheirMembershipEnds_thenItIsDisabled() {
        // given
        UUID jane = member("Jane", "Doe");
        UUID accountId = account(jane, "doe.jane", Set.of(Role.MEMBER)).getId();

        // when
        RosterSyncOutcome outcome = sync.apply(endingsFor(jane));

        // then
        assertThat(accounts.findById(accountId).orElseThrow().isEnabled()).isFalse();
        assertThat(outcome.accountsDisabled()).isEqualTo(1);
        assertThat(outcome.rolesRemoved()).isZero();
    }

    @Test
    void givenAnOfficerWhoseMembershipTheSnapshotEnded_whenTheyBookAMemberCard_thenTheCardRefusesThem() {
        // given
        UUID richard = member("Richard", "Miles");
        UUID accountId = account(richard, "miles.richard",
                Set.of(Role.MEMBER, Role.TREASURER)).getId();

        // when
        sync.apply(endingsFor(richard));

        // then
        UserAccount account = accounts.findById(accountId).orElseThrow();
        assertThat(account.isEnabled()).isTrue();
        assertThat(account.getRoles()).containsExactly(Role.TREASURER);
        assertThatThrownBy(() -> bookings.create(bookingFor(richard, account.getRoles())))
                .isInstanceOfSatisfying(DomainFailure.class,
                        failure -> assertThat(failure.problemType().slug())
                                .isEqualTo("card-role-required"));
    }

    @Test
    void givenTheOfficerBeforeTheSnapshot_whenTheyBookTheSameCard_thenItIsAccepted() {
        // given
        UUID richard = member("Richard", "Miles");
        UserAccount account = account(richard, "miles.richard",
                Set.of(Role.MEMBER, Role.TREASURER));

        // when / then
        assertThat(bookings.create(bookingFor(richard, account.getRoles()))).isNotNull();
    }

    @Test
    void givenTheOnlyEnabledAdministrator_whenTheirMembershipEnds_thenTheirAccountStaysEnabled() {
        // given
        UUID mary = member("Mary", "Major");
        UUID accountId = account(mary, "major.mary", Set.of(Role.MEMBER, Role.ADMIN)).getId();

        // when
        sync.apply(endingsFor(mary));

        // then
        UserAccount account = accounts.findById(accountId).orElseThrow();
        assertThat(account.isEnabled()).isTrue();
        assertThat(account.getRoles()).containsExactly(Role.ADMIN);
    }

    @Test
    void givenAnAccountABoardDisabled_whenTheSnapshotListsThemAsACurrentMember_thenItStaysDisabled() {
        // given
        UUID john = identity.createPerson("John", "Roe", "john.roe@example.org");
        UserAccount account = account(john, "roe.john", Set.of(Role.MEMBER));
        identity.disableAccount(account.getId());

        // when
        sync.apply(new RosterChangeSet(List.of(), List.of(new RosterChangeSet.PersonCorrection(
                john, "4711", "John", "Roe", "john.roe@example.org", STANDARD_MEMBERSHIP, false)), List.of()));

        // then
        assertThat(accounts.findById(account.getId()).orElseThrow().isEnabled()).isFalse();
        assertThat(members.findCurrentByPersonId(john)).isPresent();
    }

    @Test
    void givenAPersonThisInstanceDoesNotHold_whenApplying_thenTheirRecordIsCreatedWithNoAccount() {
        // when
        RosterSyncOutcome outcome = sync.apply(new RosterChangeSet(
                List.of(new RosterChangeSet.NewPerson("4711", "Jane", "Doe",
                        "jane.doe@example.org", STANDARD_MEMBERSHIP, false)),
                List.of(), List.of()));

        // then
        UUID created = outcome.createdPersonIdsByExternalId().get("4711");
        assertThat(created).isNotNull();
        assertThat(persons.findById(created).orElseThrow().getLastName()).isEqualTo("Doe");
        assertThat(members.findCurrentByPersonId(created)).isPresent();
        assertThat(accounts.findByPersonIdIn(List.of(created))).isEmpty();
    }

    @Test
    void givenACreationAskingForAnAccount_whenApplying_thenOneIsOpenedForTheMemberRoleAlone() {
        // when
        RosterSyncOutcome outcome = sync.apply(new RosterChangeSet(
                List.of(new RosterChangeSet.NewPerson("4711", "Jane", "Doe",
                        "jane.doe@example.org", STANDARD_MEMBERSHIP, true)),
                List.of(), List.of()));

        // then
        UUID created = outcome.createdPersonIdsByExternalId().get("4711");
        assertThat(outcome.accountsCreated()).isEqualTo(1);
        assertThat(accounts.findByPersonIdIn(List.of(created))).singleElement()
                .satisfies(account -> {
                    assertThat(account.getUsername()).isEqualTo("doe.jane");
                    assertThat(account.getRoles()).containsExactly(Role.MEMBER);
                    assertThat(account.isEnabled()).isTrue();
                    assertThat(account.isPasswordChangeRequired()).isTrue();
                });
    }

    @Test
    void givenAUsernameSomebodyAlreadyHolds_whenTwoRowsWouldTakeIt_thenEachGetsItsOwn() {
        // given
        UUID held = identity.createPerson("Jane", "Doe", "jane.doe@example.org");
        account(held, "doe.jane", Set.of(Role.MEMBER));

        // when
        RosterSyncOutcome outcome = sync.apply(new RosterChangeSet(
                List.of(new RosterChangeSet.NewPerson("4711", "Jane", "Doe",
                                "jane.doe.1@example.org", STANDARD_MEMBERSHIP, true),
                        new RosterChangeSet.NewPerson("4712", "Jane", "Doe",
                                "jane.doe.2@example.org", STANDARD_MEMBERSHIP, true)),
                List.of(), List.of()));

        // then
        assertThat(outcome.accountsCreated()).isEqualTo(2);
        assertThat(accounts.findAll()).extracting(UserAccount::getUsername)
                .contains("doe.jane", "doe.jane.2", "doe.jane.3");
    }

    @Test
    void givenAMemberTheClubHasBeenMissingAnAccountFor_whenACorrectionAsksForOne_thenItIsOpened() {
        // given
        UUID jane = member("Jane", "Doe");

        // when
        RosterSyncOutcome outcome = sync.apply(new RosterChangeSet(List.of(),
                List.of(new RosterChangeSet.PersonCorrection(jane, "4711", null, "Roe", null, null,
                        true)),
                List.of()));

        // then — the username follows the name the correction leaves behind, not the one it replaced
        assertThat(outcome.accountsCreated()).isEqualTo(1);
        assertThat(accounts.findByPersonIdIn(List.of(jane))).singleElement()
                .extracting(UserAccount::getUsername).isEqualTo("roe.jane");
    }

    @Test
    void givenACreationWhoseNameNormalisesToNothing_whenAnAccountIsAsked_thenTheNumberCarriesIt() {
        // when
        RosterSyncOutcome outcome = sync.apply(new RosterChangeSet(
                List.of(new RosterChangeSet.NewPerson("10473", "\u82b1\u5b50", "\u5c71\u7530",
                        "hanako.yamada@example.org", STANDARD_MEMBERSHIP, true)),
                List.of(), List.of()));

        // then
        UUID created = outcome.createdPersonIdsByExternalId().get("10473");
        assertThat(accounts.findByPersonIdIn(List.of(created))).singleElement()
                .extracting(UserAccount::getUsername).isEqualTo("member.10473");
    }

    @Test
    void givenACorrectionNamingOnlyTheLastName_whenApplying_thenTheOtherFieldsAreLeftAlone() {
        // given
        UUID jane = member("Jane", "Doe");

        // when
        sync.apply(new RosterChangeSet(List.of(),
                List.of(new RosterChangeSet.PersonCorrection(jane, "4711", null, "Roe", null, null, false)),
                List.of()));

        // then
        Person person = persons.findById(jane).orElseThrow();
        assertThat(person.getLastName()).isEqualTo("Roe");
        assertThat(person.getFirstName()).isEqualTo("Jane");
        assertThat(person.getEmail()).isEqualTo("jane.doe@example.org");
    }

    @Test
    void givenAMembershipThatAlreadyEnded_whenTheSnapshotEndsItAgain_thenNothingChanges() {
        // given
        UUID jane = member("Jane", "Doe");
        UUID accountId = account(jane, "doe.jane", Set.of(Role.MEMBER)).getId();
        sync.apply(endingsFor(jane));

        // when
        RosterSyncOutcome second = sync.apply(endingsFor(jane));

        // then
        assertThat(second.accountsDisabled()).isZero();
        assertThat(second.rolesRemoved()).isZero();
        assertThat(accounts.findById(accountId).orElseThrow().isEnabled()).isFalse();
        assertThat(members.findByPersonId(jane).orElseThrow().getEndedOn()).isNotNull();
    }

    private static RosterChangeSet endingsFor(UUID personId) {
        return new RosterChangeSet(List.of(), List.of(), List.of(personId));
    }

    private CreateBookingCommand bookingFor(UUID personId, Set<Role> roles) {
        return new CreateBookingCommand(List.of(courtId), memberOnlyCardId,
                new TimeSlot(SIX_PM, SEVEN_PM), null, personId, roles, null, List.of(), null);
    }

    private UUID member(String firstName, String lastName) {
        UUID personId = identity.createPerson(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org");
        members.save(memberSince(personId, STANDARD_MEMBERSHIP));
        return personId;
    }

    private UserAccount account(UUID personId, String username, Set<Role> roles) {
        UUID accountId = identity.createEnabledAccount(personId, username, roles);
        return accounts.findById(accountId).orElseThrow();
    }
}
