package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.booking.BookingService;
import org.courtside.booking.CreateBookingCommand;
import org.courtside.booking.internal.CardRoleRequiredException;
import org.courtside.card.BookingCard;
import org.courtside.card.internal.BookingCardRepository;
import org.courtside.facility.Court;
import org.courtside.facility.CourtRepository;
import org.courtside.facility.OpeningHours;
import org.courtside.facility.OpeningHoursRepository;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.OpeningWindow;
import org.courtside.shared.TimeSlot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.courtside.member.MemberFixtures.memberSince;

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
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    @Autowired
    private BookingCardRepository cards;

    @Autowired
    private CourtRepository courts;

    @Autowired
    private OpeningHoursRepository openingHours;

    @Autowired
    private BookingService bookings;

    private UUID courtId;
    private UUID memberOnlyCardId;

    @BeforeEach
    void setUp() {
        courtId = courts.save(new Court(1, "Court 1")).getId();
        for (DayOfWeek day : DayOfWeek.values()) {
            openingHours.save(new OpeningHours(day,
                    new OpeningWindow(LocalTime.of(8, 0), LocalTime.of(22, 0))));
        }
        memberOnlyCardId = cards.save(new BookingCard("Members only", "#B85C38",
                Set.of(Role.MEMBER), Set.of(), new short[]{}, false, false, false)).getId();
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
                .isInstanceOf(CardRoleRequiredException.class);
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
        UUID john = persons.save(new Person("John", "Roe", "john.roe@example.org")).getId();
        UserAccount account = account(john, "roe.john", Set.of(Role.MEMBER));
        account.disable();
        accounts.saveAndFlush(account);

        // when
        sync.apply(new RosterChangeSet(List.of(), List.of(new RosterChangeSet.PersonCorrection(
                john, "John", "Roe", "john.roe@example.org", STANDARD_MEMBERSHIP)), List.of()));

        // then
        assertThat(accounts.findById(account.getId()).orElseThrow().isEnabled()).isFalse();
        assertThat(members.findCurrentByPersonId(john)).isPresent();
    }

    @Test
    void givenAPersonThisInstanceDoesNotHold_whenApplying_thenTheirRecordIsCreatedWithNoAccount() {
        // when
        RosterSyncOutcome outcome = sync.apply(new RosterChangeSet(
                List.of(new RosterChangeSet.NewPerson("4711", "Jane", "Doe",
                        "jane.doe@example.org", STANDARD_MEMBERSHIP)),
                List.of(), List.of()));

        // then
        UUID created = outcome.createdPersonIdsByExternalId().get("4711");
        assertThat(created).isNotNull();
        assertThat(persons.findById(created).orElseThrow().getLastName()).isEqualTo("Doe");
        assertThat(members.findCurrentByPersonId(created)).isPresent();
        assertThat(accounts.findByPersonIdIn(List.of(created))).isEmpty();
    }

    @Test
    void givenACorrectionNamingOnlyTheLastName_whenApplying_thenTheOtherFieldsAreLeftAlone() {
        // given
        UUID jane = member("Jane", "Doe");

        // when
        sync.apply(new RosterChangeSet(List.of(),
                List.of(new RosterChangeSet.PersonCorrection(jane, null, "Roe", null, null)),
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
        UUID personId = persons.save(new Person(firstName, lastName,
                firstName.toLowerCase() + "." + lastName.toLowerCase() + "@example.org")).getId();
        members.save(memberSince(personId, STANDARD_MEMBERSHIP));
        return personId;
    }

    private UserAccount account(UUID personId, String username, Set<Role> roles) {
        UserAccount account = new UserAccount(persons.findById(personId).orElseThrow(),
                username, "hash", roles);
        account.enable();
        return accounts.saveAndFlush(account);
    }
}
