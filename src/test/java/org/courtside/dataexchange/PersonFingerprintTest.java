package org.courtside.dataexchange;

import org.courtside.dataexchange.internal.PersonFingerprint;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PersonFingerprintTest {

    private static final UUID TYPE = UUID.fromString("cccccccc-0000-0000-0000-000000000001");

    @Test
    void givenTwoPeopleWhoseFieldsOnlyDifferInWhereTheySplit_thenTheirFingerprintsDiffer() {
        // when
        String left = PersonFingerprint.of("Jane", "DoeX", "jane@example.org", TYPE, true, false);
        String right = PersonFingerprint.of("JaneD", "oeX", "jane@example.org", TYPE, true, false);

        // then
        assertThat(left).isNotEqualTo(right);
    }

    @Test
    void givenTheSamePerson_thenTheFingerprintIsStable() {
        // when / then
        assertThat(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true, false))
                .isEqualTo(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true, false));
    }

    @Test
    void whenSomebodyStartsSigningIn_thenTheFingerprintChanges() {
        // when / then — a preview that said an account would be opened no longer describes
        // somebody who has one, so the execution has to notice
        assertThat(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true, false))
                .isNotEqualTo(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true, true));
    }

    @Test
    void whenAMembershipEnds_thenTheFingerprintChanges() {
        // when / then
        assertThat(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true, false))
                .isNotEqualTo(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, false, false));
    }
}
