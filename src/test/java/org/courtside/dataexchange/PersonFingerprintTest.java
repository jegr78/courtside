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
        String left = PersonFingerprint.of("Jane", "DoeX", "jane@example.org", TYPE, true);
        String right = PersonFingerprint.of("JaneD", "oeX", "jane@example.org", TYPE, true);

        // then
        assertThat(left).isNotEqualTo(right);
    }

    @Test
    void givenTheSamePerson_thenTheFingerprintIsStable() {
        // when / then
        assertThat(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true))
                .isEqualTo(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true));
    }

    @Test
    void whenAMembershipEnds_thenTheFingerprintChanges() {
        // when / then
        assertThat(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, true))
                .isNotEqualTo(PersonFingerprint.of("Jane", "Doe", "jane@example.org", TYPE, false));
    }
}
