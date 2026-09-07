package org.courtside;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class CryptographicInventoryTest {

    private static final Path INVENTORY = Path.of("security/cryptographic-inventory.json");
    private static final Pattern ROLE = Pattern.compile("[a-z]+(-[a-z]+)*");

    // What counts as a cryptographic use, per surface. Only names this project writes: a version
    // the platform moves must never require an inventory edit.
    private static final Map<String, Pattern> SCANNED = Map.of(
            "src/main/java", Pattern.compile("MessageDigest|SecureRandom|PasswordEncoder|Cipher"
                    + "|KeyStore|SSLContext|javax\\.crypto|java\\.security\\.Signature"),
            "tools", Pattern.compile("createHash|createHmac|createSign|randomBytes"
                    + "|webcrypto|crypto\\.subtle"),
            "frontend/src", Pattern.compile("crypto\\.subtle|getRandomValues|crypto\\.randomUUID"),
            ".github/workflows", Pattern.compile("cosign|openssl |actions/attest"),
            "deploy", Pattern.compile("(?i)\\btls\\b|DKIM|sslmode"));

    // Prose about a cipher is not a use of one, and every surface here carries documentation.
    private static final String DOCUMENTATION = ".md";

    @Test
    void givenEveryCryptographicUse_whenTheSourceIsScanned_thenEachMapsToAnInventoryEntry()
            throws IOException {
        // given
        List<PathMatcher> inventoried = locations().stream()
                .map(location -> FileSystems.getDefault().getPathMatcher("glob:" + location))
                .toList();

        // when
        Set<Path> found = new TreeSet<>();
        for (Map.Entry<String, Pattern> surface : SCANNED.entrySet()) {
            found.addAll(filesMatching(Path.of(surface.getKey()), surface.getValue()));
        }

        // then
        assertThat(found)
                .as("every cryptographic use must be inventoried in %s", INVENTORY)
                .isNotEmpty()
                .allSatisfy(use -> assertThat(inventoried)
                        .as("%s uses cryptography and no inventory entry names it", use)
                        .anyMatch(location -> location.matches(use)));
    }

    // An entry naming nothing is an inventory describing a past release.
    @Test
    void givenTheInventory_whenItsLocationsAreRead_thenEachOneNamesSomething() throws IOException {
        // given
        Set<Path> present = new TreeSet<>();
        for (String surface : SCANNED.keySet()) {
            present.addAll(filesMatching(Path.of(surface), Pattern.compile("")));
        }

        // when / then
        assertThat(locations()).allSatisfy(location -> assertThat(present)
                .as("%s is named by the inventory and matches no file", location)
                .anyMatch(FileSystems.getDefault().getPathMatcher("glob:" + location)::matches));
    }

    @Test
    void givenEveryEntry_whenItIsRead_thenItAnswersTheLifecycleQuestions() throws IOException {
        // when / then
        for (JsonNode item : inventory().get("entries")) {
            assertThat(item.propertyNames())
                    .as("entry %s", item.get("id").asText())
                    .contains("id", "purpose", "algorithm", "class", "owner", "storageBoundary",
                            "permittedUse", "rotation", "revocation", "recovery", "retirement",
                            "evidence", "locations");
            assertThat(item.get("owner").asText())
                    .as("owner of %s names a role, never a person", item.get("id").asText())
                    .matches(ROLE);
        }
    }

    // A claim about which test proves an entry is worth nothing if that file does not exist.
    @Test
    void givenEveryEntry_whenItsEvidenceIsRead_thenEachFileItNamesExists() throws IOException {
        // when / then
        for (JsonNode item : inventory().get("entries")) {
            for (String named : item.get("evidence").asText().split(",")) {
                assertThat(Path.of(named.strip()))
                        .as("evidence named by %s", item.get("id").asText())
                        .exists();
            }
        }
    }

    // The inventory is tracked and public. It records where material lives, never the material.
    @Test
    void givenTheInventory_whenItIsRead_thenItCarriesNoKeyMaterial() throws IOException {
        // when / then
        assertThat(Files.readString(INVENTORY, StandardCharsets.UTF_8))
                .doesNotContain("BEGIN", "PRIVATE KEY", "-----")
                .doesNotContainPattern("\"[A-Za-z0-9+/]{40,}={0,2}\"");
    }

    private static Set<String> locations() throws IOException {
        Set<String> locations = new HashSet<>();
        for (JsonNode item : inventory().get("entries")) {
            item.get("locations").forEach(location -> locations.add(location.asText()));
        }
        return locations;
    }

    private static JsonNode inventory() throws IOException {
        return new ObjectMapper().readTree(INVENTORY.toFile());
    }

    private static List<Path> filesMatching(Path root, Pattern pattern) throws IOException {
        List<Path> matches = new ArrayList<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                if (file.toString().endsWith(DOCUMENTATION)) {
                    continue;
                }
                if (pattern.matcher(Files.readString(file, StandardCharsets.UTF_8)).find()) {
                    matches.add(file);
                }
            }
        }
        return matches;
    }
}
