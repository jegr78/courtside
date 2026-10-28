package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class MfaRecoveryCodesTest {
    private static final String CODE = "ABCD-EFGH-JKMN-PQRS-TVWX-YZ23";

    @Test
    void whenGeneratingARecoverySet_thenTenIndependentLongCodesCanBeStoredAsVerifiers() {
        // when
        var codes = MfaRecoveryCodes.generate();
        // then
        assertThat(codes).hasSize(10).doesNotHaveDuplicates();
        Set<String> hashes = new HashSet<>();
        for (String code : codes) {
            assertThat(code).matches("[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){5}");
            var verifier = MfaRecoveryCodes.verifier(code);
            assertThat(verifier).isPresent();
            assertThat(verifier.orElseThrow()).matches("[0-9a-f]{64}").doesNotContain(code);
            hashes.add(verifier.orElseThrow());
        }
        assertThat(hashes).hasSize(10);
    }

    @Test
    void givenAnExistingSet_whenGeneratingItsReplacement_thenNoCodeOrVerifierIsReused() {
        // given
        var previous = MfaRecoveryCodes.generate();
        // when
        var replacement = MfaRecoveryCodes.generate();
        // then
        assertThat(previous).hasSize(10);
        assertThat(replacement).hasSize(10).doesNotContainAnyElementsOf(previous);
        assertThat(replacement.stream().map(code -> MfaRecoveryCodes.verifier(code).orElseThrow()).toList())
                .doesNotContainAnyElementsOf(previous.stream().map(code -> MfaRecoveryCodes.verifier(code).orElseThrow()).toList());
    }

    @Test
    void givenATypedRecoveryCode_whenCaseAndSeparatorsChange_thenItsVerifierStillMatches() {
        // when / then
        assertThat(MfaRecoveryCodes.verifier(CODE)).isPresent();
        assertThat(MfaRecoveryCodes.verifier(CODE.toLowerCase(Locale.ROOT).replace('-', ' ')))
                .isEqualTo(MfaRecoveryCodes.verifier(CODE));
        assertThat(MfaRecoveryCodes.verifier(CODE.replace("-", "")))
                .isEqualTo(MfaRecoveryCodes.verifier(CODE));
    }

    @Test
    void givenACodeUsedForMfa_whenFingerprinting_thenThePasswordResetNamespaceCannotRedeemIt() {
        // when
        var verifier = MfaRecoveryCodes.verifier(CODE);
        // then
        assertThat(verifier).isPresent();
        assertThat(verifier.orElseThrow()).isNotEqualTo(ResetCodes.fingerprint(CODE));
    }

    @Test
    void givenMalformedOrShortRecoveryCodes_whenFingerprinting_thenNoVerifierIsAccepted() {
        // when / then
        for (String code : new String[] {null, "", "ABCD-EFGH", CODE + "A", CODE.replace('A', '!'), " ".repeat(128)}) {
            assertThat(MfaRecoveryCodes.verifier(code)).isEmpty();
        }
    }
}
