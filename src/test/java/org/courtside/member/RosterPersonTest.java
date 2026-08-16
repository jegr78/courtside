package org.courtside.member;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.courtside.shared.CursorPage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Set;
import java.util.UUID;

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
        assertThat(persons.findByEmailIgnoreCase("family.doe@example.org"))
                .extracting(Person::getId)
                .containsExactlyInAnyOrder(parent.personId(), child.personId());
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
    void whenCreatingAPersonWithABlankFirstName_thenTheServiceRefusesItsOwnCaller() {
        // when / then — the contract rejects this at the edge, so a blank name reaching the
        // service means a caller skipped the validation that precedes it
        assertThatThrownBy(() -> roster.createPerson("  ", "Doe", "jane.doe@example.org"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("first name");
    }
}
