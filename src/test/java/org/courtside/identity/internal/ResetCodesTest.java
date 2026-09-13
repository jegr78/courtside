package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

class ResetCodesTest {

    @Test
    void whenGeneratingACode_thenItIsGroupedTheWayTheMailPrintsIt() {
        // when
        String code = ResetCodes.generate();

        // then
        assertThat(code).hasSize(9).matches("^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$");
    }

    @Test
    void whenGeneratingManyCodes_thenTheyDifferAndNoGlyphCouldBeReadAsAnother() {
        // when
        Set<String> codes = new HashSet<>();
        Set<Character> drawnCharacters = new TreeSet<>();
        for (int drawn = 0; drawn < 2000; drawn++) {
            String code = ResetCodes.generate();
            codes.add(code);
            code.chars().filter(character -> character != '-')
                    .forEach(character -> drawnCharacters.add((char) character));
        }

        // then — one draw cannot see the alphabet, and the alphabet is where the property lives
        assertThat(codes).hasSize(2000);
        assertThat(drawnCharacters)
                .as("a member retyping from a mail must not have to choose between two readings")
                .containsExactlyElementsOf("23456789ABCDEFGHJKMNPQRSTVWXYZ".chars()
                        .mapToObj(character -> (char) character).toList());
    }

    @Test
    void givenTheSeparatorAndTheCaseAMemberTyped_whenNormalising_thenTheSameCodeIsFound() {
        // given
        String code = "ABCD-EFGH";

        // when / then — neither the separator nor the case carries meaning, so neither may decide
        assertThat(ResetCodes.fingerprint("abcd-efgh")).isEqualTo(ResetCodes.fingerprint(code));
        assertThat(ResetCodes.fingerprint("ABCDEFGH")).isEqualTo(ResetCodes.fingerprint(code));
        assertThat(ResetCodes.fingerprint("abcd efgh")).isEqualTo(ResetCodes.fingerprint(code));
        assertThat(ResetCodes.fingerprint("  ABCD-EFGH  ")).isEqualTo(ResetCodes.fingerprint(code));
    }

    @Test
    void whenFingerprintingACode_thenNothingOfItSurvivesInTheResult() {
        // when
        String fingerprint = ResetCodes.fingerprint("ABCD-EFGH");

        // then
        assertThat(fingerprint).matches("^[0-9a-f]{64}$");
        assertThat(fingerprint).doesNotContain("abcd").doesNotContain("efgh");
        assertThat(ResetCodes.fingerprint("ABCD-EFGJ"))
                .as("two codes that differ by one character must not share a fingerprint")
                .isNotEqualTo(fingerprint);
    }
}
