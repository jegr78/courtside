package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class ReferenceDeploymentDocumentationTest {

    private static final Pattern VARIABLE = Pattern.compile("\\$\\{(COURTSIDE_[A-Z0-9_]+)");

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
