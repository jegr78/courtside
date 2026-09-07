package org.courtside.identity.internal;

import org.courtside.config.ClubIdentity;
import org.junit.jupiter.api.Test;

import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PasswordPolicyTest {

    private static final String USERNAME = "major.mary";
    private static final String ADDRESS = "mary.major@example.org";

    // A club name is rarely one word, and a rule that only matched the whole of it would be
    // defeated by leaving out any part: this is the case the seeded single-word name cannot show.
    @Test
    void givenAMultiWordClubName_whenAPasswordCarriesOneOfItsWords_thenItIsRefused() {
        // given
        PasswordPolicy policy = policyFor("Example Tennis Club");

        // when / then
        assertThatThrownBy(() -> policy.requireUnguessable(
                "scaffold-example-lattice", USERNAME, ADDRESS))
                .isInstanceOf(GuessablePasswordException.class);
        assertThatThrownBy(() -> policy.requireUnguessable(
                "scaffold-tennis-lattice", USERNAME, ADDRESS))
                .isInstanceOf(GuessablePasswordException.class);
    }

    // The counter-case to the split: a word the club name does not contain stays allowed, so the
    // refusals above are about those words and not about the length of the passphrase.
    @Test
    void givenAMultiWordClubName_whenAPasswordCarriesNoneOfItsWords_thenItIsAccepted() {
        // given
        PasswordPolicy policy = policyFor("Example Tennis Club");

        // when / then
        assertThatCode(() -> policy.requireUnguessable(
                "scaffold-marmoset-lattice", USERNAME, ADDRESS))
                .doesNotThrowAnyException();
    }

    // Without a floor every passphrase containing a syllable of the club name would be refused,
    // which pushes a member back towards the short passwords this policy exists to prevent.
    @Test
    void givenAClubNameWithAShortWord_whenAPasswordCarriesOnlyThatWord_thenItIsAccepted() {
        // given
        PasswordPolicy policy = policyFor("Oak Bay Racquet");

        // when / then
        assertThatCode(() -> policy.requireUnguessable(
                "scaffold-oak-bay-lattice", USERNAME, ADDRESS))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> policy.requireUnguessable(
                "scaffold-racquet-lattice", USERNAME, ADDRESS))
                .isInstanceOf(GuessablePasswordException.class);
    }

    @Test
    void givenAnAccountWithoutAnAddress_whenAPasswordIsChecked_thenTheOtherTermsStillApply() {
        // given
        PasswordPolicy policy = policyFor("Example Tennis Club");

        // when / then
        assertThatCode(() -> policy.requireUnguessable("scaffold-marmoset-lattice", USERNAME, null))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> policy.requireUnguessable("scaffold-major.mary-x", USERNAME, null))
                .isInstanceOf(GuessablePasswordException.class);
    }

    private static PasswordPolicy policyFor(String clubName) {
        return new PasswordPolicy(new ClubIdentity() {
            @Override
            public String clubName() {
                return clubName;
            }

            @Override
            public String defaultLocale() {
                return "de";
            }

            @Override
            public ZoneId zoneId() {
                return ZoneId.of("UTC");
            }
        });
    }
}
