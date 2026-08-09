package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.MatchResult;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

// Nothing is seeded, so the README tells an operator how to hash the first admin's password by
// hand. Those parameters and the ones this application hashes with are one fact in three places.
class PasswordHashingTest extends AbstractIntegrationTest {

    private static final List<Path> PLACES_THAT_NAME_THE_PARAMETERS =
            List.of(Path.of("README.md"), Path.of("docs/design.md"));

    // Matches the hash's own "m=19456,t=2,p=1" and the prose naming the same three in backticks;
    // backticks are stripped first, so one pattern covers both.
    private static final Pattern PARAMETERS =
            Pattern.compile("m=(\\d+),\\s*t=(\\d+),\\s*p=(\\d+)");

    private static final Pattern COMMAND = Pattern.compile(
            "openssl rand -base64 (\\d+).*?-id -k (\\d+) -t (\\d+) -p (\\d+) -l (\\d+)");

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
    void whenReadingTheCommandTheReadmePublishes_thenItProducesTheSameHashShape()
            throws IOException {
        // given — the prose can be right while the command is wrong, and it is the command that
        // creates the hash an operator pastes into the database
        String hash = hash();
        String[] produced = parametersOf(hash).split(",");

        // when
        Matcher command = COMMAND.matcher(withoutBackticks(Path.of("README.md")));

        // then
        assertThat(command.find()).as("README.md must publish an argon2 command").isTrue();
        assertThat(base64Length(Integer.parseInt(command.group(1))))
                .as("openssl rand -base64 %s is the salt the command passes, and argon2 takes it"
                        + " as the literal string", command.group(1))
                .isEqualTo(saltOf(hash).length);
        assertThat(command.group(2)).as("memory in KiB, which -k takes directly").isEqualTo(produced[0]);
        assertThat(command.group(3)).as("iterations").isEqualTo(produced[1]);
        assertThat(command.group(4)).as("parallelism").isEqualTo(produced[2]);
        assertThat(Integer.parseInt(command.group(5)))
                .as("hash length in bytes").isEqualTo(hashOf(hash).length);
    }

    @Test
    void whenAPasswordWasHashedWithTheOlderParameters_thenItStillVerifies() {
        // given — raising the cost must not lock out an account created before the change. Argon2
        // encodes its parameters, so matches() reads them from the stored hash.
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

    // "$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>", both segments unpadded base64.
    private static byte[] saltOf(String argon2Hash) {
        return Base64.getDecoder().decode(argon2Hash.split("\\$")[4]);
    }

    private static byte[] hashOf(String argon2Hash) {
        return Base64.getDecoder().decode(argon2Hash.split("\\$")[5]);
    }

    private static int base64Length(int bytes) {
        return (bytes + 2) / 3 * 4;
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
