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
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.MatchResult;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class DeploymentImageParityTest {

    private static final Path DEPLOY = Path.of("deploy");
    private static final List<Path> READERS = List.of(
            Path.of("frontend/e2e/container-images.ts"),
            Path.of("tools/security-environment.mjs"));

    private static final Pattern COMPOSE_FILE = Pattern.compile("compose[\\w.-]*\\.yaml");
    private static final Pattern ANY_DIGEST = Pattern.compile("@sha256:[a-f0-9]{64}");
    private static final Pattern ANY_PIN = Pattern.compile(
            "(?:(?<=:-)|(?<![\\w./-]))([a-z0-9][\\w./-]*)(?::([\\w.-]+))?@sha256:([a-f0-9]{64})");
    private static final Pattern REQUIRED_VARIABLE = Pattern.compile("\\$\\{\\w+(?:}|:?\\?)");
    private static final Pattern VARIANT = Pattern.compile("-(?:alpine|with-browser)$");
    private static final Pattern IMAGE_LINE = Pattern.compile("(?m)^\\s*image:\\s*[\"']?([^\\s\"']+)");

    @Test
    void whenTheDeploymentNamesAnImage_thenEveryFileUnderItAgreesOnOneVersionAndDigest() throws Exception {
        // when
        Map<String, Set<String>> digestsByReference = new TreeMap<>();
        Map<String, Set<String>> versionsByRepository = new TreeMap<>();
        Map<String, Set<String>> taggedDigests = new TreeMap<>();
        Map<String, Set<String>> taglessDigests = new TreeMap<>();
        for (Pin pin : deploymentPins()) {
            (pin.tag() == null ? taglessDigests : taggedDigests)
                    .computeIfAbsent(pin.repository(), key -> new TreeSet<>()).add(pin.digest());
            digestsByReference.computeIfAbsent(pin.reference(), key -> new TreeSet<>()).add(pin.digest());
            if (pin.tag() != null) {
                versionsByRepository.computeIfAbsent(pin.repository(), key -> new TreeSet<>()).add(pin.version());
            }
        }

        // then
        assertThat(digestsByReference).as("the files under deploy/ pin images").isNotEmpty();
        assertThat(unreadImages()).as("every third-party image under deploy/ is a pin this test reads").isEmpty();
        assertThat(digestsByReference).allSatisfy((reference, digests) -> assertThat(digests)
                .as("the files under deploy/ name one digest for %s", reference).hasSize(1));
        assertThat(versionsByRepository).allSatisfy((repository, versions) -> assertThat(versions)
                .as("the files under deploy/ run one version of %s", repository).hasSize(1));
        assertThat(taglessDigests).allSatisfy((repository, digests) -> assertThat(
                taggedDigests.getOrDefault(repository, digests))
                .as("a pin of %s without a tag names a digest one of its tags already has", repository)
                .containsAll(digests));
    }

    @Test
    void whenAFileOutsideTheDeploymentPinsADeployedImage_thenItIsTheDeployedPin() throws Exception {
        // given
        List<Pin> deployed = deploymentPins();
        Set<String> repositories = new TreeSet<>();
        Set<String> pins = new TreeSet<>();
        deployed.forEach(pin -> {
            repositories.add(pin.repository());
            pins.add(pin.text());
            pins.add(pin.repository() + "@sha256:" + pin.digest());
        });

        // when
        List<String> diverging = new ArrayList<>();
        for (Path file : sources()) {
            if (!file.startsWith(DEPLOY)) {
                for (Pin pin : pinsIn(file)) {
                    if (repositories.contains(pin.repository()) && !pins.contains(pin.text())) {
                        diverging.add(file + " names " + pin.text());
                    }
                }
            }
        }

        // then
        assertThat(diverging)
                .as("an image deploy/ pins runs at that pin everywhere else as well")
                .isEmpty();
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

    private static List<Pin> deploymentPins() throws IOException {
        List<Pin> pins = new ArrayList<>();
        for (Path file : sources()) {
            if (file.startsWith(DEPLOY)) {
                pins.addAll(pinsIn(file));
            }
        }
        return pins;
    }

    private static List<Pin> pinsIn(Path file) throws IOException {
        return pinsIn(content(file));
    }

    private static String withoutDefaultRegistry(String repository) {
        return repository.replaceFirst("^docker\\.io/(library/)?", "");
    }

    private static List<String> unreadImages() throws IOException {
        List<String> unread = new ArrayList<>();
        for (Path file : sources()) {
            if (file.startsWith(DEPLOY)) {
                for (MatchResult line : IMAGE_LINE.matcher(content(file)).results().toList()) {
                    String image = line.group(1);
                    boolean candidate = REQUIRED_VARIABLE.matcher(image).find()
                            || image.replaceFirst("^\\$\\{\\w+:-", "").startsWith("courtside:");
                    if (!candidate && pinsIn(image).isEmpty()) {
                        unread.add(file + " runs " + image);
                    }
                }
            }
        }
        return unread;
    }

    private static List<Pin> pinsIn(String text) {
        return ANY_PIN.matcher(text).results()
                .map(match -> new Pin(withoutDefaultRegistry(match.group(1)), match.group(2), match.group(3)))
                .toList();
    }

    // A variant such as k6's "-with-browser" is a different image of the same release; a pre-release is not.
    private record Pin(String repository, String tag, String digest) {

        String reference() {
            return tag == null ? repository : repository + ":" + tag;
        }

        String version() {
            return VARIANT.matcher(tag).replaceFirst("");
        }

        String text() {
            return reference() + "@sha256:" + digest;
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
