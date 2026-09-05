package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class ReferenceDeploymentDocumentationTest {

    private static final Pattern VARIABLE = Pattern.compile("\\$\\{(COURTSIDE_[A-Z0-9_]+)");

    private static final Pattern RECORD_KIND = Pattern.compile("\\b(PTR|MX|SPF|DKIM|DMARC)\\b");

    private static final Pattern CHECK_SUBJECT =
            Pattern.compile("(?m)^\\s*report (?:ok|fail) \"([^\"]*)\"");

    @Test
    void whenReadingCompose_thenEveryVariableItReadsIsInTheEnvironmentExample() throws IOException {
        // given
        List<String> variables = variablesReadByCompose();
        String example = Files.readString(Path.of("deploy/.env.example"));

        // when / then
        assertThat(variables)
                .as("a club copies .env.example and edits it, so a variable missing from it is a "
                        + "variable nobody knows exists")
                .allSatisfy(variable -> assertThat(example)
                        .containsPattern("(?m)^#? ?" + Pattern.quote(variable) + "="));
    }

    @Test
    void givenTheReferenceDeployment_whenNoSourceWasChosen_thenComposeRequiresAnExplicitOffer()
            throws IOException {
        // given
        String compose = Files.readString(Path.of("deploy/compose.yaml"));
        String example = Files.readString(Path.of("deploy/.env.example"));

        // when / then
        assertThat(compose).contains(
                "COURTSIDE_SOURCE_URL: ${COURTSIDE_SOURCE_URL:?set COURTSIDE_SOURCE_URL in .env}");
        assertThat(example)
                .containsPattern("(?m)^COURTSIDE_SOURCE_URL=$")
                .doesNotContain("COURTSIDE_SOURCE_URL=https://github.com/jegr78/courtside");
    }

    @Test
    void whenReadingCompose_thenEveryVariableItReadsIsInTheOperatorDocumentation() throws IOException {
        // given
        List<String> variables = variablesReadByCompose();
        String readme = Files.readString(Path.of("deploy/README.md"));

        // when / then
        assertThat(variables)
                .as("the environment variables are a published surface, and an undocumented one "
                        + "cannot be a promise")
                .allSatisfy(variable -> assertThat(readme).contains("| `" + variable + "` |"));
    }

    @Test
    void whenReadingCompose_thenTheMailServerPublishesOnlyWhatAnMtaNeeds() throws IOException {
        // when
        List<String> published = publishedPortsOf("mail");

        // then
        assertThat(published)
                .as("submission, IMAP and the admin interface belong on no public address, and a "
                        + "port added here reaches the internet the moment somebody restarts the stack")
                .containsExactly("25:25", "127.0.0.1:${COURTSIDE_MAIL_ADMIN_PORT:-8081}:8080");
    }

    @Test
    void whenReadingTheMailCheck_thenEveryRecordItVerifiesIsOneTheReferenceTellsAnOperatorToPublish()
            throws IOException {
        // given
        Set<String> verified = recordKindsIn(String.join("\n", checkSubjects()));
        Set<String> published = recordKindsIn(String.join("\n", dnsTableRecordColumn()));

        // when / then
        assertThat(published)
                .as("an operator reads a failing check and looks the record up in the reference, "
                        + "so the two have to name the same records in the same words")
                .isEqualTo(verified);
    }

    private static List<String> checkSubjects() throws IOException {
        Matcher subjects = CHECK_SUBJECT.matcher(Files.readString(Path.of("deploy/mail-check.sh")));
        List<String> reported = subjects.results().map(match -> match.group(1)).toList();
        assertThat(reported).as("deploy/mail-check.sh reports what it found").isNotEmpty();
        return reported;
    }

    private static Set<String> recordKindsIn(String text) {
        Matcher kinds = RECORD_KIND.matcher(text);
        return kinds.results().map(match -> match.group(1)).collect(Collectors.toCollection(TreeSet::new));
    }

    private static List<String> dnsTableRecordColumn() throws IOException {
        List<String> lines = Files.readAllLines(Path.of("deploy/README.md"));
        int header = lines.indexOf("| Record | Where | Why |");
        assertThat(header).as("deploy/README.md holds a table of the records DNS has to publish")
                .isNotNegative();
        List<String> column = new ArrayList<>();
        for (String line : lines.subList(header + 2, lines.size())) {
            if (!line.startsWith("|")) {
                break;
            }
            column.add(line.split("\\|")[1]);
        }
        assertThat(column).as("the table of published records has rows").isNotEmpty();
        return column;
    }

    private static List<String> publishedPortsOf(String service) throws IOException {
        List<String> lines = Files.readAllLines(Path.of("deploy/compose.yaml"));
        int start = lines.indexOf("  " + service + ":");
        assertThat(start).as("%s is a service in deploy/compose.yaml", service).isNotNegative();
        List<String> published = new ArrayList<>();
        boolean inPorts = false;
        for (String line : lines.subList(start + 1, lines.size())) {
            if (!line.startsWith("    ")) {
                break;
            }
            if (line.strip().equals("ports:")) {
                inPorts = true;
            } else if (inPorts && line.strip().startsWith("- ")) {
                published.add(line.strip().substring(2).replace("\"", ""));
            } else if (!line.startsWith("      ")) {
                inPorts = false;
            }
        }
        return published;
    }

    private static List<String> variablesReadByCompose() throws IOException {
        Matcher variables = VARIABLE.matcher(Files.readString(Path.of("deploy/compose.yaml")));
        return variables.results().map(match -> match.group(1)).distinct().sorted().toList();
    }
}
