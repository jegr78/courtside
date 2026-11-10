package org.courtside.shared.web;

import org.courtside.shared.ApplicationShellText;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.CannotCreateTransactionException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@ExtendWith(OutputCaptureExtension.class)
class ApplicationShellFallbackTest {

    private static final String SHELL = """
            <!doctype html>
            <html lang="de">
              <head>
                <title>Courtside</title>
              </head>
              <body></body>
            </html>
            """;

    @TempDir
    private Path build;

    @Test
    void givenTheClubTextCannotBeRead_whenTheShellIsRequested_thenTheUnchangedShellIsServedAndOneWarningLogged(
            CapturedOutput output) throws IOException {
        // given
        Files.writeString(build.resolve("index.html"), SHELL);
        ApplicationShellText unreachable = () -> {
            throw new CannotCreateTransactionException("Could not open JPA EntityManager for transaction");
        };
        SpaConfiguration.ApplicationShell shell = new SpaConfiguration.ApplicationShell(unreachable);
        shell.setLocations(List.of(new FileSystemResource(build.toString() + "/")));

        // when
        Resource first = shell.getResource(new MockHttpServletRequest("GET", "/login"));
        Resource second = shell.getResource(new MockHttpServletRequest("GET", "/courts"));

        // then
        assertThat(first).as("an unreadable club text still serves the shell").isNotNull();
        assertThat(first.getContentAsString(StandardCharsets.UTF_8)).isEqualTo(SHELL);
        assertThat(second.getContentAsString(StandardCharsets.UTF_8)).isEqualTo(SHELL);
        assertThat(output.getAll().lines().filter(line -> line.contains("WARN")).toList())
                .as("one warning for the outage").hasSize(1);
        assertThat(output.getAll()).as("the warning carries the failed lookup and its stack")
                .contains("CannotCreateTransactionException", "ApplicationShellFallbackTest.lambda");
    }

    @Test
    void givenTheDatabaseRefusesTheLookup_whenTheShellIsRequested_thenTheUnchangedShellIsServed() throws IOException {
        // given
        Files.writeString(build.resolve("index.html"), SHELL);
        SpaConfiguration.ApplicationShell shell = new SpaConfiguration.ApplicationShell(() -> {
            throw new DataAccessResourceFailureException("Connection refused");
        });
        shell.setLocations(List.of(new FileSystemResource(build.toString() + "/")));

        // when
        Resource served = shell.getResource(new MockHttpServletRequest("GET", "/login"));

        // then
        assertThat(served.getContentAsString(StandardCharsets.UTF_8)).isEqualTo(SHELL);
    }

    @Test
    void givenAProgrammingError_whenTheShellIsRequested_thenItIsNotHidden() throws IOException {
        // given
        Files.writeString(build.resolve("index.html"), SHELL);
        SpaConfiguration.ApplicationShell shell = new SpaConfiguration.ApplicationShell(() -> {
            throw new IllegalStateException("The manifest texts are missing from the image");
        });
        shell.setLocations(List.of(new FileSystemResource(build.toString() + "/")));

        // when / then
        assertThatThrownBy(() -> shell.getResource(new MockHttpServletRequest("GET", "/login")))
                .as("only a failed data access falls back to the built shell")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void givenALookupThatRecoversAndFailsAgain_whenTheShellIsRequested_thenEachOutageIsWarnedOnce(
            CapturedOutput output) throws IOException {
        // given
        Files.writeString(build.resolve("index.html"), SHELL);
        AtomicInteger calls = new AtomicInteger();
        ApplicationShellText flaky = () -> {
            if (calls.incrementAndGet() == 2) {
                return new ApplicationShellText.Text("en", "Book courts at Example Tennis Club");
            }
            throw new CannotCreateTransactionException("Could not open JPA EntityManager for transaction");
        };
        SpaConfiguration.ApplicationShell shell = new SpaConfiguration.ApplicationShell(flaky);
        shell.setLocations(List.of(new FileSystemResource(build.toString() + "/")));

        // when
        shell.getResource(new MockHttpServletRequest("GET", "/login"));
        Resource recovered = shell.getResource(new MockHttpServletRequest("GET", "/login"));
        shell.getResource(new MockHttpServletRequest("GET", "/login"));
        shell.getResource(new MockHttpServletRequest("GET", "/login"));

        // then
        assertThat(recovered.getContentAsString(StandardCharsets.UTF_8)).contains("<html lang=\"en\">");
        assertThat(output.getAll().lines().filter(line -> line.contains("WARN")).toList())
                .as("a recovered lookup re-arms the warning, a continuing outage does not repeat it").hasSize(2);
    }
}
