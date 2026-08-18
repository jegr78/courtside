package org.courtside.member.internal;

import org.courtside.member.PersonFieldLimits;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class PersonTextTest {

    private static final String DOCUMENT = "/api/openapi.yaml";

    @Test
    void whenReadingEveryCodePoint_thenTheContractAndTheStripperCallTheSameThingsWhitespace()
            throws IOException {
        // given
        Pattern nonBlank = Pattern.compile(patternOf("firstName"));
        List<String> disagreements = new ArrayList<>();

        // when
        for (int codePoint = Character.MIN_CODE_POINT; codePoint <= Character.MAX_CODE_POINT; codePoint++) {
            if (Character.isBmpCodePoint(codePoint) && Character.isSurrogate((char) codePoint)) {
                continue;
            }
            if (Character.isISOControl(codePoint)) {
                continue;
            }
            String single = new String(Character.toChars(codePoint));
            boolean contractRefusesIt = !nonBlank.matcher(single).matches();
            boolean stripperRemovesIt = PersonText.stripped(single).isEmpty();
            if (contractRefusesIt != stripperRemovesIt) {
                disagreements.add("U+%04X".formatted(codePoint));
            }
        }

        // then
        assertThat(disagreements)
                .as("a code point the contract calls whitespace but the stripper keeps survives as"
                        + " padding on a stored name; one the stripper removes but the contract"
                        + " accepts can strip a value down to nothing and reach the service's guard")
                .isEmpty();
    }

    // Control characters are the one thing both sides refuse outright rather than strip, so they
    // are asserted here instead of through the stripper, which only ever removes at the ends.
    @Test
    void whenReadingEveryControlCharacter_thenNeitherTheContractNorTheServiceAcceptsIt()
            throws IOException {
        // given
        Pattern nonBlank = Pattern.compile(patternOf("firstName"));
        List<String> accepted = new ArrayList<>();

        // when
        for (int codePoint = Character.MIN_CODE_POINT; codePoint <= Character.MAX_CODE_POINT; codePoint++) {
            if (!Character.isISOControl(codePoint)) {
                continue;
            }
            String inside = "Mary" + new String(Character.toChars(codePoint)) + "Major";
            if (nonBlank.matcher(inside).matches() || PersonFieldLimits.isUsableName(inside)) {
                accepted.add("U+%04X".formatted(codePoint));
            }
        }

        // then
        assertThat(accepted)
                .as("a control character PostgreSQL refuses to store must be refused where it"
                        + " enters, not at the INSERT")
                .isEmpty();
    }

    @Test
    void whenReadingThePersonRequestSchema_thenBothNamesCarryTheSameNonBlankPattern()
            throws IOException {
        // when / then
        assertThat(patternOf("lastName")).isEqualTo(patternOf("firstName"));
    }

    @Test
    void whenReadingTheAddressPattern_thenItCarriesTheRuleTheServiceEnforces() throws IOException {
        // given
        Pattern address = Pattern.compile(patternOf("email"));

        // when / then
        assertThat(address.matcher("mary.major@example.org").matches()).isTrue();
        assertThat(address.matcher("mary.major@localhost").matches()).isFalse();
        assertThat(address.matcher("").matches()).isFalse();
        assertThat(address.matcher(" ").matches()).isFalse();
        assertThat(address.matcher("mary major@example.org").matches()).isFalse();
        assertThat(address.matcher("mary@major@example.org").matches()).isFalse();
    }

    @Test
    void whenReadingTheNonBlankPattern_thenALineBreakCannotAppearInsideAName() throws IOException {
        // given
        Pattern nonBlank = Pattern.compile(patternOf("firstName"));

        // when / then
        assertThat(nonBlank.matcher("Mary\nMajor").matches()).isFalse();
        assertThat(nonBlank.matcher("Mary\rMajor").matches()).isFalse();
        assertThat(nonBlank.matcher("Mary Major").matches()).isTrue();
    }

    @SuppressWarnings("unchecked")
    private static String patternOf(String property) throws IOException {
        Map<String, Object> document;
        try (InputStream in = PersonTextTest.class.getResourceAsStream(DOCUMENT)) {
            assertThat(in).as("the API document must be on the classpath at %s", DOCUMENT).isNotNull();
            document = new Yaml().load(in);
        }
        Map<String, Object> components = (Map<String, Object>) document.get("components");
        Map<String, Object> schemas = (Map<String, Object>) components.get("schemas");
        Map<String, Object> personRequest = (Map<String, Object>) schemas.get("PersonRequest");
        Map<String, Object> properties = (Map<String, Object>) personRequest.get("properties");
        Map<String, Object> field = (Map<String, Object>) properties.get(property);
        String pattern = (String) field.get("pattern");
        assertThat(pattern).as("PersonRequest.%s must carry a pattern", property).isNotNull();
        return pattern;
    }
}
