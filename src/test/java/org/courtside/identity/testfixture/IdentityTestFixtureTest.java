package org.courtside.identity.testfixture;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@Import(IdentityTestFixture.class)
class IdentityTestFixtureTest extends AbstractIntegrationTest {

    @Autowired
    private IdentityTestFixture identity;

    @Test
    void givenPersonDetails_whenCreatingPerson_thenOnlyIdentifierAndObservationsAreExposed() {
        // given / when
        UUID personId = identity.createPerson("Jane", "Doe", "jane.doe@example.org");

        // then
        assertThat(identity.personExists(personId)).isTrue();
        assertThat(identity.personName(personId)).isEqualTo("Jane Doe");
    }

    @Test
    void givenRoles_whenCreatingEnabledAccount_thenSecurityStateIsExplicit() {
        // given
        UUID personId = identity.createPerson("Mary", "Major");

        // when
        UUID accountId = identity.createEnabledAccount(
                personId, "major.mary", Set.of(Role.MEMBER, Role.ADMIN));

        // then
        assertThat(identity.accountExists(accountId)).isTrue();
        assertThat(identity.isAccountEnabled(accountId)).isTrue();
        assertThat(identity.accountRoles(accountId)).containsExactlyInAnyOrder(Role.MEMBER, Role.ADMIN);
        assertThat(identity.personIdForUsername("major.mary")).isEqualTo(personId);
    }
}
