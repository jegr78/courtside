package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.MatchResult;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

// The design's published Argon2 parameters and the encoder configuration are one fact.
class PasswordHashingTest extends AbstractIntegrationTest {

    private static final List<Path> PLACES_THAT_NAME_THE_PARAMETERS =
            List.of(Path.of("README.md"), Path.of("docs/design.md"));

    // Matches the hash's own "m=19456,t=2,p=1" and the prose naming the same three in backticks.
    private static final Pattern PARAMETERS =
            Pattern.compile("m=(\\d+),\\s*t=(\\d+),\\s*p=(\\d+)");

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Test
    void whenHashingAPassword_thenTheParametersAreTheOnesTheDocumentsPublish() throws IOException {
        // given
        String produced = parametersOf(hash());

        // when
        TreeSet<String> published = new TreeSet<>();
        for (Path place : PLACES_THAT_NAME_THE_PARAMETERS) {
            PARAMETERS.matcher(withoutBackticks(place)).results()
                    .forEach(result -> published.add(triple(result)));
        }

        // then
        assertThat(published)
                .as("%s must name %s wherever they name Argon2 parameters, and nothing else — an"
                        + " operator following them produces the hash this application would have",
                        PLACES_THAT_NAME_THE_PARAMETERS, produced)
                .containsExactly(produced);
    }

    @Test
    void whenAPasswordWasHashedWithTheOlderParameters_thenItStillVerifies() {
        // given
        Argon2PasswordEncoder asItUsedToBe = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
        String storedBeforeTheChange = asItUsedToBe.encode("correct horse battery staple");

        // when / then
        assertThat(parametersOf(storedBeforeTheChange)).isEqualTo("16384,2,1");
        assertThat(passwordEncoder.matches("correct horse battery staple", storedBeforeTheChange))
                .as("an account hashed at the old cost must still be able to log in")
                .isTrue();
        assertThat(passwordEncoder.matches("wrong", storedBeforeTheChange)).isFalse();
    }

    private String hash() {
        return passwordEncoder.encode("correct horse battery staple");
    }

    private static String parametersOf(String argon2Hash) {
        Matcher matcher = PARAMETERS.matcher(argon2Hash);
        assertThat(matcher.find()).as("an Argon2 hash states its own parameters").isTrue();
        return triple(matcher.toMatchResult());
    }

    private static String triple(MatchResult result) {
        return result.group(1) + "," + result.group(2) + "," + result.group(3);
    }

    private static String withoutBackticks(Path document) throws IOException {
        return Files.readString(document).replace("`", "");
    }
}
