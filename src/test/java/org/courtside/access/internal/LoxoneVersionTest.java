package org.courtside.access.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.JsonNodeFactory;

import static org.assertj.core.api.Assertions.assertThat;

class LoxoneVersionTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void givenTheSingleQuotedValueTheMiniserverSends_whenRead_thenTheVersionIsFound() {
        // given
        String value = "{'snr': '50:4F:94:A0:EE:01', 'version':'14.2.5.16', 'key':'1a2b3c', 'isInTrust':0,"
                + " 'local':false, 'httpsStatus':1}";

        // when / then
        assertThat(LoxoneVersion.of(JsonNodeFactory.instance.stringNode(value))).map(LoxoneVersion::toString)
                .as("a single-quoted pseudo-JSON string").contains("14.2.5.16");
    }

    @Test
    void givenAnObjectValue_whenRead_thenTheVersionIsFound() {
        // given
        String value = "{\"snr\":\"50:4F:94:A0:EE:01\",\"version\":\"14.3.1.2\"}";

        // when / then
        assertThat(LoxoneVersion.of(JSON.readTree(value))).map(LoxoneVersion::toString)
                .as("a value the client already parsed as JSON").contains("14.3.1.2");
    }

    @ParameterizedTest
    @ValueSource(strings = {"{'snr':'50:4F:94:A0:EE:01'}", "{'version':'fourteen'}", "{'version':''}", "",
            "{'version':'1234567.1'}"})
    void givenAValueWithoutAReadableVersion_whenRead_thenThereIsNone(String value) {
        // when / then
        assertThat(LoxoneVersion.of(JsonNodeFactory.instance.stringNode(value))).as(value).isEmpty();
    }

    @Test
    void givenNoValue_whenRead_thenThereIsNone() {
        // when / then
        assertThat(LoxoneVersion.of(null)).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"14.10, 14.2, true", "14.2, 14.10, false", "14.2.5.16, 14.2.5.16, true", "14.2.5, 14.2.5.16, false",
            "14.2.5.16.0, 14.2.5.16, true", "15, 14.2.5.16, true", "14.2.5.9, 14.2.5.16, false"})
    void givenTwoVersions_whenCompared_thenEachSegmentCountsAsANumber(String found, String minimum, boolean atLeast) {
        // given
        LoxoneVersion version = LoxoneVersion.of(JsonNodeFactory.instance.stringNode("{'version':'" + found + "'}"))
                .orElseThrow();
        LoxoneVersion floor = LoxoneVersion.of(JsonNodeFactory.instance.stringNode("{'version':'" + minimum + "'}"))
                .orElseThrow();

        // when / then
        assertThat(version.atLeast(floor)).as(found + " against " + minimum).isEqualTo(atLeast);
    }
}
