package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.member.internal.PersonNotFoundException;
import org.courtside.shared.CursorPage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RosterPersonTest extends AbstractIntegrationTest {

    private static final UUID MEMBERSHIP_TYPE_ID = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Autowired
    private PersonRepository persons;

    @Autowired
    private UserAccountRepository accounts;

    @Autowired
    private MemberRepository members;

    @Autowired
    private RosterService roster;

    @Test
    void whenCreatingAPerson_thenTheyCarryNoAccountAndNoMembership() {
        // when
        RosterService.RosterEntry created =
                roster.createPerson("Mary", "Major", "mary.major@example.org");

        // then
        assertThat(created.firstName()).isEqualTo("Mary");
        assertThat(created.lastName()).isEqualTo("Major");
        assertThat(created.email()).isEqualTo("mary.major@example.org");
        assertThat(created.accountId()).isNull();
        assertThat(created.username()).isNull();
        assertThat(created.enabled()).isFalse();
        assertThat(created.membershipTypeId()).isNull();
        assertThat(created.roles()).isEmpty();
    }

    @Test
    void whenCreatingAPerson_thenTheRosterListsThem() {
        // when
        RosterService.RosterEntry created =
                roster.createPerson("Jane", "Doe", "jane.doe@example.org");

        // then
        CursorPage.Result<RosterService.RosterEntry> page = roster.list(null, null, 50);
        assertThat(page.items()).extracting(RosterService.RosterEntry::personId)
                .containsExactly(created.personId());
    }

    @Test
    void givenAnEmailTheRosterAlreadyHolds_whenCreatingAChildOnIt_thenBothPeopleExist() {
        // given — a club enrols children under a parent's address, so the second row must stand
        RosterService.RosterEntry parent =
                roster.createPerson("Jane", "Doe", "family.doe@example.org");

        // when
        RosterService.RosterEntry child =
                roster.createPerson("Mary", "Doe", "family.doe@example.org");

        // then
        assertThat(child.personId()).isNotEqualTo(parent.personId());
        assertThat(persons.findAllById(List.of(parent.personId(), child.personId())))
                .extracting(Person::getEmail)
                .containsExactly("family.doe@example.org", "family.doe@example.org");
    }

    @Test
    void givenAPerson_whenChangingThem_thenTheNameAndTheEmailAreCorrected() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when
        RosterService.RosterEntry changed =
                roster.changePerson(jane.getId(), "Jane", "Major", "jane.major@example.org");

        // then
        assertThat(changed.personId()).isEqualTo(jane.getId());
        assertThat(changed.lastName()).isEqualTo("Major");
        assertThat(changed.email()).isEqualTo("jane.major@example.org");
        assertThat(persons.findById(jane.getId())).get()
                .satisfies(stored -> {
                    assertThat(stored.getLastName()).isEqualTo("Major");
                    assertThat(stored.getEmail()).isEqualTo("jane.major@example.org");
                });
    }

    @Test
    void givenAPersonHoldingAnAccountAndAMembership_whenChangingThem_thenBothSurvive() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount account = new UserAccount(jane, "jane.doe", "hash", Set.of(Role.MEMBER));
        account.enable();
        accounts.save(account);
        members.save(new Member(jane.getId(), MEMBERSHIP_TYPE_ID));

        // when
        RosterService.RosterEntry changed =
                roster.changePerson(jane.getId(), "Jane", "Major", "jane.major@example.org");

        // then
        assertThat(changed.accountId()).isEqualTo(account.getId());
        assertThat(changed.username()).isEqualTo("jane.doe");
        assertThat(changed.enabled()).isTrue();
        assertThat(changed.roles()).containsExactly(Role.MEMBER);
        assertThat(changed.membershipTypeId()).isEqualTo(MEMBERSHIP_TYPE_ID);
    }

    @Test
    void givenAnUnknownPerson_whenChangingThem_thenTheFailureNamesWhatWasNotFound() {
        // given
        UUID absent = UUID.fromString("00000000-0000-0000-0000-0000000000ff");

        // when / then
        assertThatThrownBy(() -> roster.changePerson(absent, "Jane", "Doe", "jane.doe@example.org"))
                .isInstanceOf(PersonNotFoundException.class)
                .hasMessageContaining(absent.toString());
    }

    @Test
    void givenAnEmailAnotherPersonHolds_whenChangingAChildOntoIt_thenTheChangeStands() {
        // given — the same family the create case describes, one screen later
        RosterService.RosterEntry parent =
                roster.createPerson("Jane", "Doe", "family.doe@example.org");
        RosterService.RosterEntry child =
                roster.createPerson("Mary", "Doe", "mary.doe@example.org");

        // when
        RosterService.RosterEntry changed =
                roster.changePerson(child.personId(), "Mary", "Doe", "family.doe@example.org");

        // then
        assertThat(changed.email()).isEqualTo("family.doe@example.org");
        assertThat(persons.findAllById(List.of(parent.personId(), child.personId())))
                .extracting(Person::getEmail)
                .containsExactly("family.doe@example.org", "family.doe@example.org");
    }

    @Test
    void givenNamesPaddedWithWhitespace_whenCreatingAPerson_thenTheyAreStoredWithoutThePadding() {
        // given — a no-break space is what a paste from a word processor leaves behind, and
        // String.strip does not remove it although the contract calls it whitespace
        String noBreakSpace = Character.toString(0x00a0);

        // when
        RosterService.RosterEntry created = roster.createPerson(
                noBreakSpace + "Mary ", "  Major" + noBreakSpace, "  mary.major@example.org  ");

        // then — the roster orders by lower(last_name), so padding would sort a person ahead of
        // the whole club
        assertThat(created.firstName()).isEqualTo("Mary");
        assertThat(created.lastName()).isEqualTo("Major");
        assertThat(created.email()).isEqualTo("mary.major@example.org");
        assertThat(persons.findById(created.personId())).get()
                .satisfies(stored -> assertThat(stored.getDisplayName()).isEqualTo("Mary Major"));
    }

    @Test
    void givenNamesPaddedWithWhitespace_whenChangingAPerson_thenTheyAreStoredWithoutThePadding() {
        // given
        Person jane = persons.save(new Person("Jane", "Doe", "jane.doe@example.org"));

        // when
        RosterService.RosterEntry changed =
                roster.changePerson(jane.getId(), " Jane ", " Major ", " jane.major@example.org ");

        // then
        assertThat(changed.firstName()).isEqualTo("Jane");
        assertThat(changed.lastName()).isEqualTo("Major");
        assertThat(changed.email()).isEqualTo("jane.major@example.org");
    }

    static Stream<String> blankFirstNames() {
        return Stream.of("  ", Character.toString(0x2003), Character.toString(0x3000));
    }

    @ParameterizedTest
    @MethodSource("blankFirstNames")
    void givenAFirstNameBlankByUnicodeOrSpaces_whenCreatingAPerson_thenTheServiceRefusesItsOwnCaller(
            String blank) {
        // when / then — the contract rejects all of these at the edge, so one reaching the
        // service means a caller skipped the validation that precedes it
        assertThatThrownBy(() -> roster.createPerson(blank, "Doe", "jane.doe@example.org"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("first name");
    }
}
