package org.courtside.identity.internal;

import org.courtside.config.ClubIdentity;
import org.courtside.identity.Person;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.ZoneId;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PasswordPolicyTest {

    // Four sources that share no substring, so each refusal below names exactly one of them.
    private static final String STORED = "stored-credential-hash";
    private static final UserAccount ACCOUNT =
            accountOf("wren8842", "Mary", "Major", "quill.harbor@example.org");
    private static final PasswordPolicy POLICY = policyFor("Example Tennis Club");

    @Test
    void givenAPasswordCarryingTheUsername_whenItIsChecked_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> POLICY.requireUnguessable("scaffold-wren8842-lattice", ACCOUNT))
                .isInstanceOf(GuessablePasswordException.class);
    }

    // The name is what a member reaches for first, and an address or a username that hides it — an
    // initial, a membership number — leaves nothing else to catch it.
    @Test
    void givenAPasswordCarryingTheMembersName_whenItIsChecked_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> POLICY.requireUnguessable("scaffold-major-lattice", ACCOUNT))
                .isInstanceOf(GuessablePasswordException.class);
        assertThatThrownBy(() -> POLICY.requireUnguessable("scaffold-mary-lattice", ACCOUNT))
                .isInstanceOf(GuessablePasswordException.class);
    }

    @Test
    void givenAPasswordCarryingTheAddressItWasSentTo_whenItIsChecked_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> POLICY.requireUnguessable("scaffold-quill.harbor", ACCOUNT))
                .isInstanceOf(GuessablePasswordException.class);
    }

    // A club name is rarely one word, and a rule that only matched the whole of it would be
    // defeated by leaving out any part.
    @Test
    void givenAMultiWordClubName_whenAPasswordCarriesOneOfItsWords_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> POLICY.requireUnguessable("scaffold-example-lattice", ACCOUNT))
                .isInstanceOf(GuessablePasswordException.class);
        assertThatThrownBy(() -> POLICY.requireUnguessable("scaffold-tennis-lattice", ACCOUNT))
                .isInstanceOf(GuessablePasswordException.class);
    }

    // The counter-case to all four: without it a policy that refused everything would look
    // identical, and the refusals above would prove nothing about the terms they name.
    @Test
    void givenAPasswordCarryingNoneOfThem_whenItIsChecked_thenItIsAccepted() {
        // when / then
        assertThatCode(() -> POLICY.requireUnguessable("scaffold-marmoset-lattice", ACCOUNT))
                .doesNotThrowAnyException();
    }

    // Without a floor every passphrase containing a syllable of the club name would be refused,
    // which pushes a member back towards the short passwords this policy exists to prevent.
    @Test
    void givenAClubNameWithAShortWord_whenAPasswordCarriesOnlyThatWord_thenItIsAccepted() {
        // given
        PasswordPolicy policy = policyFor("Oak Bay Racquet");

        // when / then
        assertThatCode(() -> policy.requireUnguessable("scaffold-oak-bay-lattice", ACCOUNT))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> policy.requireUnguessable("scaffold-racquet-lattice", ACCOUNT))
                .isInstanceOf(GuessablePasswordException.class);
    }

    @Test
    void givenAnAccountWithoutAnAddress_whenAPasswordIsChecked_thenTheOtherTermsStillApply() {
        // given
        UserAccount addressless = accountOf("wren8842", "Mary", "Major", null);

        // when / then
        assertThatCode(() -> POLICY.requireUnguessable("scaffold-marmoset-lattice", addressless))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> POLICY.requireUnguessable("scaffold-wren8842-x", addressless))
                .isInstanceOf(GuessablePasswordException.class);
    }

    // Whoever read the message that carried it knows this one, so keeping it is no better than
    // the day it was sent, and the account would never expire the credential again.
    @Test
    void givenTheStoredCredential_whenItIsCheckedAgain_thenItIsRefused() {
        // when / then
        assertThatThrownBy(() -> POLICY.requireUnguessable(STORED, ACCOUNT))
                .isInstanceOf(ReusedCredentialException.class);
    }

    // A null here is this application's own bug, not a member's input, and it must not leave as
    // the NullPointerException that a dereference two lines down would produce.
    @Test
    void givenNoPasswordAtAll_whenTheCheckRuns_thenItSaysWhatWentWrong() {
        // when / then
        assertThatThrownBy(() -> POLICY.requireUnguessable(null, ACCOUNT))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("A password reached the policy without being validated");
    }

    private static UserAccount accountOf(
            String username, String firstName, String lastName, String emailAddress) {
        return new UserAccount(new Person(firstName, lastName, emailAddress),
                username, STORED, Set.of(Role.MEMBER), "de");
    }

    private static PasswordPolicy policyFor(String clubName) {
        return new PasswordPolicy(clubIdentity(clubName), new PasswordEncoder() {
            @Override
            public String encode(CharSequence raw) {
                return raw.toString();
            }

            @Override
            public boolean matches(CharSequence raw, String encoded) {
                return encoded.contentEquals(raw);
            }
        });
    }

    private static ClubIdentity clubIdentity(String clubName) {
        return new ClubIdentity() {
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
        };
    }
}
