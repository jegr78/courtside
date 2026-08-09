package org.courtside.identity;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

// The README tells an operator how to hash the first admin's password by hand, because nothing is
// seeded. Those parameters and the ones this application hashes with are one fact written in two
// places: let them drift and a user_account table ends up holding two shapes, only one of which
// anybody reviewed.
//
// Compared against what the encoder actually produces rather than against a constant — a constant
// could be wrong in the same way the README is.
class PasswordHashingTest extends AbstractIntegrationTest {

    // Matches both forms the README uses: the hash's own "m=32768,t=2,p=1" and the prose that
    // names the same three in backticks. Backticks are stripped first, so one pattern covers both.
    private static final Pattern PARAMETERS =
            Pattern.compile("m=(\\d+),\\s*t=(\\d+),\\s*p=(\\d+)");

    // The command an operator actually runs. Its -m is a power of two, not a count of kibibytes,
    // which is the whole reason these parameters are what they are.
    private static final Pattern COMMAND =
            Pattern.compile("argon2 .*-id -m (\\d+) -t (\\d+) -p (\\d+) -l (\\d+)");

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Test
    void whenHashingAPassword_thenTheParametersAreTheOnesTheReadmePublishes() throws IOException {
        // given
        String produced = parametersOf(passwordEncoder.encode("correct horse battery staple"));

        // when
        TreeSet<String> published = new TreeSet<>();
        Matcher documented = PARAMETERS.matcher(readmeWithoutBackticks());
        documented.results().forEach(result -> published.add(triple(result)));

        // then
        assertThat(published)
                .as("README.md must name %s everywhere it names Argon2 parameters, and nothing"
                        + " else — an operator following it produces the hash this application"
                        + " would have produced", produced)
                .containsExactly(produced);
    }

    @Test
    void whenReadingTheCommandTheReadmePublishes_thenItProducesThoseSameParameters()
            throws IOException {
        // given — the prose can be right while the command is wrong, and it is the command that
        // creates the hash an operator pastes into the database
        String[] produced = parametersOf(passwordEncoder.encode("correct horse battery staple"))
                .split(",");
        int memory = Integer.parseInt(produced[0]);

        // when
        Matcher command = COMMAND.matcher(readmeWithoutBackticks());

        // then
        assertThat(command.find()).as("README.md must publish an argon2 command").isTrue();
        assertThat(1 << Integer.parseInt(command.group(1)))
                .as("argon2 -m takes the memory cost as a power of two kibibytes, so -m must be"
                        + " log2(%s)", memory)
                .isEqualTo(memory);
        assertThat(command.group(2)).as("iterations").isEqualTo(produced[1]);
        assertThat(command.group(3)).as("parallelism").isEqualTo(produced[2]);
        assertThat(command.group(4)).as("hash length in bytes").isEqualTo("32");
    }

    @Test
    void whenAPasswordWasHashedWithTheOlderParameters_thenItStillVerifies() {
        // given — raising the cost must not lock out an account created before the change. Argon2
        // encodes its parameters, so matches() reads them from the stored hash; a change that
        // broke this would be invisible until the first login after an upgrade.
        Argon2PasswordEncoder asItUsedToBe = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
        String storedBeforeTheChange = asItUsedToBe.encode("correct horse battery staple");

        // when / then
        assertThat(parametersOf(storedBeforeTheChange)).isEqualTo("16384,2,1");
        assertThat(passwordEncoder.matches("correct horse battery staple", storedBeforeTheChange))
                .as("an account whose password was hashed at the old cost must still be able to"
                        + " log in")
                .isTrue();
        assertThat(passwordEncoder.matches("wrong", storedBeforeTheChange)).isFalse();
    }

    private static String parametersOf(String argon2Hash) {
        Matcher matcher = PARAMETERS.matcher(argon2Hash);
        assertThat(matcher.find()).as("an Argon2 hash states its own parameters").isTrue();
        return triple(matcher.toMatchResult());
    }

    private static String triple(java.util.regex.MatchResult result) {
        return result.group(1) + "," + result.group(2) + "," + result.group(3);
    }

    private static String readmeWithoutBackticks() throws IOException {
        return Files.readString(Path.of("README.md")).replace("`", "");
    }
}
