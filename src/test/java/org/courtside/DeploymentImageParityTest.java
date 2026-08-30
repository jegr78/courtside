package org.courtside;

import org.eclipse.jgit.dircache.DirCache;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.storage.file.FileRepositoryBuilder;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.MatchResult;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class DeploymentImageParityTest {

    private static final Path DEPLOY = Path.of("deploy");
    private static final List<Path> READERS = List.of(
            Path.of("frontend/e2e/global-setup.ts"),
            Path.of("tools/security-environment.mjs"));

    private static final Pattern COMPOSE_FILE = Pattern.compile("compose[\\w.-]*\\.yaml");
    private static final Pattern ANY_DIGEST = Pattern.compile("@sha256:[a-f0-9]{64}");

    @ParameterizedTest
    @ValueSource(strings = {"postgres", "caddy", "axllent/mailpit"})
    void whenTheDeploymentNamesAnImage_thenEveryFileUnderItAgreesOnTheDigest(String image) throws Exception {
        // when
        List<String> pinned = new ArrayList<>();
        for (Path file : sources()) {
            if (file.startsWith(DEPLOY)) {
                pinned.addAll(references(file, image));
            }
        }

        // then
        assertThat(pinned)
                .as("the files under deploy/ pin %s, and they name one digest for it", image)
                .isNotEmpty()
                .containsOnly(pinned.getFirst());
    }

    // A second literal cannot be updated by whatever bumps the first, so everything that needs one of
    // these images reads it out of the deployment, and this is what keeps that the only copy.
    @ParameterizedTest
    @ValueSource(strings = {"postgres", "caddy", "axllent/mailpit"})
    void whenAnythingElseNamesAnImage_thenItReadsTheDeploymentRatherThanRepeatingIt(String image) throws Exception {
        // when
        List<String> repeated = new ArrayList<>();
        for (Path file : sources()) {
            if (!file.startsWith(DEPLOY)) {
                references(file, image).forEach(pin -> repeated.add(file + " names " + pin));
            }
        }

        // then
        assertThat(repeated)
                .as("%s is pinned under deploy/ and read from there; nothing outside carries its own", image)
                .isEmpty();
    }

    @Test
    void whenAReaderNamesAComposeFile_thenTheDeploymentStillCarriesIt() throws IOException {
        // then
        for (Path reader : READERS) {
            List<String> named = COMPOSE_FILE.matcher(content(reader)).results()
                    .map(MatchResult::group).distinct().toList();
            assertThat(named).as("%s names the compose file it reads", reader).isNotEmpty();
            for (String file : named) {
                Path compose = DEPLOY.resolve(file);
                assertThat(compose)
                        .as("%s reads %s, and a rename there would surface only at run time", reader, compose)
                        .exists();
                assertThat(ANY_DIGEST.matcher(content(compose)).find())
                        .as("%s takes an image out of %s, which pins none", reader, compose)
                        .isTrue();
            }
        }
    }

    // What the repository holds, not what the working tree happens to contain: a local scratch file
    // is nobody's second copy, and a walk that counts it fails here while CI stays green.
    private static List<Path> sources() throws IOException {
        try (Repository repository = new FileRepositoryBuilder().findGitDir().build()) {
            DirCache index = repository.readDirCache();
            List<Path> tracked = new ArrayList<>(index.getEntryCount());
            for (int entry = 0; entry < index.getEntryCount(); entry++) {
                Path path = Path.of(index.getEntry(entry).getPathString());
                if (Files.isRegularFile(path)) {
                    tracked.add(path);
                }
            }
            return List.copyOf(tracked);
        }
    }

    private static List<String> references(Path file, String image) throws IOException {
        return pinsOf(image).matcher(content(file)).results().map(MatchResult::group).toList();
    }

    // The registry may be spelled out, so a slash before the name is part of the same reference and
    // not a boundary; a fork that shares the name is worth a red the reviewer can read.
    private static Pattern pinsOf(String image) {
        return Pattern.compile("(?<![\\w.-])" + Pattern.quote(image) + "(?::[\\w.-]+)?@sha256:[a-f0-9]{64}");
    }

    private static String content(Path file) throws IOException {
        return new String(Files.readAllBytes(file), StandardCharsets.ISO_8859_1);
    }
}
