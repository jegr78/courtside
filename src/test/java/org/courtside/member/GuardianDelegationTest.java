package org.courtside.member;

import org.courtside.config.ClubTimeZone;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.Person;
import org.courtside.identity.UserAccount;
import org.courtside.member.internal.DependantNotFoundException;
import org.courtside.member.internal.GuardianActionNotGrantedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GuardianDelegationTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 5, 12);

    private final CurrentUser currentUser = mock(CurrentUser.class);
    private final GuardianRelationships relationships = mock(GuardianRelationships.class);
    private final ClubTimeZone clubTimeZone = () -> ZoneId.of("UTC");
    private final Clock clock = Clock.fixed(Instant.parse("2026-05-12T10:00:00Z"), ZoneOffset.UTC);
    private final GuardianDelegation delegation =
            new GuardianDelegation(currentUser, relationships, clubTimeZone, clock);

    private final UUID guardianAccountId = UUID.randomUUID();
    private final UUID guardianPersonId = UUID.randomUUID();
    private final UUID dependantPersonId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        UserAccount guardian = mock(UserAccount.class);
        Person person = mock(Person.class);
        when(person.getId()).thenReturn(guardianPersonId);
        when(guardian.getId()).thenReturn(guardianAccountId);
        when(guardian.getPerson()).thenReturn(person);
        when(currentUser.requireAccount()).thenReturn(guardian);
    }

    @Test
    void givenNoRelationship_whenTheGuardianActs_thenTheRefusalIsMarkedAsAnAuthorizationRefusal() {
        // given
        when(relationships.grantsFor(guardianPersonId, dependantPersonId, TODAY)).thenReturn(Optional.empty());

        // when / then
        assertThatThrownBy(() -> delegation.require(dependantPersonId, GuardianGrant.BOOK))
                .isInstanceOfSatisfying(DependantNotFoundException.class,
                        refusal -> assertThat(refusal.refusesAuthorization()).isTrue());
    }

    @Test
    void givenARelationshipWithoutTheGrant_whenTheGuardianActs_thenTheRefusalIsMarkedAsAnAuthorizationRefusal() {
        // given
        when(relationships.grantsFor(guardianPersonId, dependantPersonId, TODAY))
                .thenReturn(Optional.of(Set.of(GuardianGrant.VIEW_BOOKINGS)));

        // when / then
        assertThatThrownBy(() -> delegation.require(dependantPersonId, GuardianGrant.BOOK))
                .isInstanceOfSatisfying(GuardianActionNotGrantedException.class,
                        refusal -> assertThat(refusal.refusesAuthorization()).isTrue());
    }

    @Test
    void givenTheGrant_whenTheGuardianActs_thenTheDependantsAccountIsReturned() {
        // given
        UserAccount dependant = mock(UserAccount.class);
        when(relationships.grantsFor(guardianPersonId, dependantPersonId, TODAY))
                .thenReturn(Optional.of(Set.of(GuardianGrant.BOOK)));
        when(relationships.accountOf(dependantPersonId)).thenReturn(Optional.of(dependant));

        // when
        GuardianDelegation.Delegation granted = delegation.require(dependantPersonId, GuardianGrant.BOOK);

        // then
        assertThat(granted.dependant()).isSameAs(dependant);
    }
}
