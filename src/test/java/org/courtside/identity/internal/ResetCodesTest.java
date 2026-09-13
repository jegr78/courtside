package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class ResetCodesTest {

    @Test
    void whenGeneratingACode_thenItReadsBackWithoutAGlyphThatCouldBeAnother() {
        // when
        String code = ResetCodes.generate();

        // then
        assertThat(code).hasSize(9).matches("^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$");
        assertThat(code)
                .as("a member retyping from a mail must not have to choose between two readings")
                .doesNotContain("0").doesNotContain("O")
                .doesNotContain("1").doesNotContain("I").doesNotContain("L")
                .doesNotContain("U");
    }

    @Test
    void whenGeneratingManyCodes_thenTheyDiffer() {
        // when
        Set<String> codes = new HashSet<>();
        for (int drawn = 0; drawn < 500; drawn++) {
            codes.add(ResetCodes.generate());
        }

        // then
        assertThat(codes).hasSize(500);
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
