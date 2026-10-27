package org.courtside.identity.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class TotpCodesTest {
    private static final byte[] REFERENCE_SECRET = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);

    @ParameterizedTest
    @CsvSource({"59,287082", "1111111109,081804", "1111111111,050471", "1234567890,005924",
            "2000000000,279037", "20000000000,353130"})
    void givenRfc6238ReferenceValues_whenGeneratingSixDigits_thenTheyMatchTheStandard(long seconds, String expected) {
        // given
        Instant now = Instant.ofEpochSecond(seconds);
        // when
        String code = TotpCodes.code(REFERENCE_SECRET, now);
        // then
        assertThat(code).isEqualTo(expected);
    }

    @Test
    void givenAReferenceSecret_whenEncodingForAnAuthenticator_thenItUsesStandardBase32() {
        // when
        String encoded = TotpCodes.encodeSecret(REFERENCE_SECRET);
        // then
        assertThat(encoded).isEqualTo("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    }

    @Test
    void givenFreshEnrollments_whenGeneratingSecrets_thenEachHasIndependent160BitMaterial() {
        // given
        Set<String> secrets = new HashSet<>();
        // when
        for (int index = 0; index < 32; index++) {
            byte[] secret = TotpCodes.newSecret();
            assertThat(secret).hasSize(20);
            assertThat(TotpCodes.encodeSecret(secret)).matches("[A-Z2-7]{32}");
            secrets.add(Base64.getEncoder().encodeToString(secret));
        }
        // then
        assertThat(secrets).hasSize(32);
    }

    @Test
    void givenAValidCode_whenMatchingIt_thenTheExactStepCanBeConsumedAtomically() {
        // given
        Instant now = Instant.ofEpochSecond(59);
        // when
        var matched = TotpCodes.match(REFERENCE_SECRET, "287082", now, -1);
        // then
        assertThat(matched).hasValue(1);
    }

    @Test
    void givenAnAlreadyConsumedStep_whenReplayingItsCode_thenItCannotBeConsumedAgain() {
        // given
        Instant now = Instant.ofEpochSecond(59);
        // when
        var matched = TotpCodes.match(REFERENCE_SECRET, "287082", now, 1);
        // then
        assertThat(matched).isEmpty();
    }

    @Test
    void givenAClockOffsetOfOneStep_whenMatching_thenEitherNeighbourIsAccepted() {
        // given
        Instant now = Instant.ofEpochSecond(59);
        // when / then
        assertThat(TotpCodes.match(REFERENCE_SECRET, "755224", now, -1)).hasValue(0);
        assertThat(TotpCodes.match(REFERENCE_SECRET, "359152", now, -1)).hasValue(2);
    }

    @Test
    void givenTheEndOfTheClockTolerance_whenTimeAdvances_thenTheOldCodeExpiresAtTheBoundary() {
        // when / then
        assertThat(TotpCodes.match(REFERENCE_SECRET, "287082", Instant.ofEpochSecond(89), -1)).hasValue(1);
        assertThat(TotpCodes.match(REFERENCE_SECRET, "287082", Instant.ofEpochSecond(90), -1)).isEmpty();
    }

    @Test
    void givenMalformedOrWrongCodes_whenMatching_thenNoneAuthenticates() {
        // given
        Instant now = Instant.ofEpochSecond(59);
        // when / then
        for (String code : new String[] {null, "", "12345", "1234567", "abcdef", " 287082", "287 082", "１２３４５６", "000000"}) {
            assertThat(TotpCodes.match(REFERENCE_SECRET, code, now, -1)).isEmpty();
        }
    }

    @Test
    void givenATimeBeforeTheUnixEpoch_whenMatching_thenNoCodeAuthenticates() {
        // when / then
        assertThat(TotpCodes.match(REFERENCE_SECRET, "755224", Instant.ofEpochSecond(-1), -1)).isEmpty();
    }
}
