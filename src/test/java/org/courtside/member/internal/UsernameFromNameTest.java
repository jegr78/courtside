package org.courtside.member.internal;

import org.junit.jupiter.api.Test;

import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class UsernameFromNameTest {

    @Test
    void givenAPlainName_whenSuggesting_thenItIsLastNameDotFirstName() {
        // when / then
        assertThat(UsernameFromName.suggestFor("Jane", "Doe", "10473", Locale.GERMAN)).isEqualTo("doe.jane");
    }

    @Test
    void givenAGermanClub_whenTheNameCarriesUmlauts_thenTheyAreWrittenOut() {
        // when / then
        assertThat(UsernameFromName.suggestFor("Jörg", "Müller", "10473", Locale.GERMAN))
                .isEqualTo("mueller.joerg");
        assertThat(UsernameFromName.suggestFor("Max", "Weiß", "10473", Locale.GERMAN)).isEqualTo("weiss.max");
    }

    @Test
    void givenAClubThatIsNotGermanSpeaking_whenTheNameCarriesMarks_thenTheyAreDropped() {
        // when / then — a Scandinavian fork is not served by writing ø as oe
        assertThat(UsernameFromName.suggestFor("Jörg", "Müller", "10473", Locale.ENGLISH))
                .isEqualTo("muller.jorg");
    }

    @Test
    void givenCharactersTheLoginNameCannotCarry_whenSuggesting_thenTheyAreLeftOut() {
        // when / then
        assertThat(UsernameFromName.suggestFor("Max", "D'Angelo", "10473", Locale.ENGLISH))
                .isEqualTo("dangelo.max");
        assertThat(UsernameFromName.suggestFor("Jan-Ole", "van der Berg", "10473", Locale.ENGLISH))
                .isEqualTo("vanderberg.jan-ole");
    }

    @Test
    void givenAVeryLongName_whenSuggesting_thenItStaysInsideWhatTheContractAllows() {
        // when
        String suggested = UsernameFromName.suggestFor("Wolfgang".repeat(6), "Schmidt".repeat(6),
                "10473", Locale.GERMAN);

        // then — the contract bounds a username at 60 and a number is still appended on collision
        assertThat(suggested.length()).isLessThanOrEqualTo(55);
        assertThat(suggested).matches("^[a-z0-9._-]+$");
    }

    @Test
    void givenANameThatLeavesNothingTheLoginNameCanCarry_whenSuggesting_thenTheMemberNumberCarriesIt() {
        // when / then — the number is what the club's own system calls this person already
        assertThat(UsernameFromName.suggestFor("大", "小", "10473", Locale.ENGLISH))
                .isEqualTo("member.10473");
    }

    @Test
    void givenANameShorterThanTheContractAllows_whenSuggesting_thenTheMemberNumberCarriesIt() {
        // when / then
        assertThat(UsernameFromName.suggestFor("", "A", "10473", Locale.ENGLISH))
                .isEqualTo("member.10473");
    }

    @Test
    void givenAMemberNumberTheLoginNameCannotCarryEither_whenSuggesting_thenSomethingUsableRemains() {
        // when
        String suggested = UsernameFromName.suggestFor("大", "小", "№ 一", Locale.ENGLISH);

        // then — never empty: the caller numbers this on collision and a board renames it after
        assertThat(suggested).isEqualTo("member").matches("^[a-z0-9._-]+$");
    }
}
