package org.courtside;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class CryptographicInventoryTest {

    private static final Path INVENTORY = Path.of("security/cryptographic-inventory.json");
    private static final Path POLICY = Path.of("docs/cryptographic-inventory.md");
    private static final Path CREDENTIAL_ISSUER = Path.of(
            "src/main/java/org/courtside/identity/internal/AccountCredentialIssuer.java");
    private static final Path BREACHED_PASSWORD_LOOKUP = Path.of(
            "src/main/java/org/courtside/identity/internal/HaveIBeenPwnedPasswordLookup.java");
    private static final Pattern ROLE = Pattern.compile("[a-z]+(-[a-z]+)*");
    private static final Pattern CREDENTIAL_BYTES = Pattern.compile(
            "CREDENTIAL_BYTES\\s*=\\s*(\\d+)");
    private static final Pattern HASH_ALGORITHM = Pattern.compile(
            "MessageDigest\\.getInstance\\(\\\"[^\\\"]+\\\"\\)"
                    + "|createHash\\([\\\"'][^\\\"']+[\\\"']\\)"
                    + "|openssl\\s+dgst\\s+-[A-Za-z0-9-]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern PASSWORD_KEY_DERIVATION = Pattern.compile(
            "(?i)PBKDF2|SecretKeyFactory|PBEKeySpec|scrypt|HKDF|deriveKey|deriveBits");

    private static final List<String> SURFACES = List.of("src/main/java", "src/main/resources",
            "tools", "frontend/src", "frontend/e2e", ".github/workflows", "deploy");

    // What counts as a use, and the token an entry has to claim in order to cover it. Only names
    // this project writes: a version the platform moves must never require an inventory edit.
    private static final Pattern USES = Pattern.compile("MessageDigest|SecureRandom|PasswordEncoder"
            + "|Cipher\\.getInstance|KeyStore\\.getInstance|javax\\.crypto|java\\.security\\.Signature"
            + "|createHash|createHmac|createSign|createVerify|randomBytes|createCipheriv"
            + "|createDecipheriv|generateKeyPair|createPrivateKey|createPublicKey|crypto\\.subtle"
            + "|getRandomValues|randomUUID|X509Certificate|fingerprint256|timingSafeEqual|cosign"
            + "|actions/attest|openssl|newkey|starttls|checkserveridentity|trust-relay"
            + "|tls internal|dkim|DKIM|CertificateFactory|keystore|key-store|truststore"
            + "|trust-store|root-certificate|sslmode|sslrootcert|sslcert|sslkey|ssl_cert_file"
            + "|ssl_key_file");

    // A digest or a random value may be covered by a pattern. Anything that handles a key has to
    // be named file by file, so a new one cannot arrive under a glob nobody re-read.
    private static final Pattern NAMED_INDIVIDUALLY = Pattern.compile("Cipher\\.getInstance"
            + "|KeyStore\\.getInstance|javax\\.crypto|java\\.security\\.Signature|createCipheriv"
            + "|createDecipheriv|generateKeyPair|createPrivateKey|createSign|createVerify"
            + "|X509Certificate|fingerprint256|newkey|CertificateFactory|keystore|key-store"
            + "|truststore|trust-store|sslcert|sslkey|ssl_key_file");

    // Prose about a cipher is not a use of one, and every surface here carries documentation.
    private static final String DOCUMENTATION = ".md";

    // The shipped password list is data rather than configuration, and among its hundred thousand
    // lines are words like "cipher" that would read as a cryptographic use.
    private static final Path DATA = Path.of("src/main/resources/security/common-passwords.txt");

    @Test
    void givenEveryCryptographicUse_whenTheSourceIsScanned_thenAnEntryClaimsThatUse()
            throws IOException {
        // given
        List<JsonNode> entries = entries();

        // when
        Map<Path, Set<String>> found = uses(USES);

        // then
        assertThat(found).as("the scan must find the cryptography this repository contains")
                .isNotEmpty();
        found.forEach((file, tokens) -> tokens.forEach(token -> assertThat(entries)
                .as("%s uses %s, and no entry both covers that file and claims %s",
                        file, token, token)
                .anyMatch(entry -> covers(entry, file) && claims(entry, token))));
    }

    @Test
    void givenAUseThatHandlesAKey_whenItIsScanned_thenAnEntryNamesTheFileRatherThanAPattern()
            throws IOException {
        // given
        List<JsonNode> entries = entries();

        // when
        Map<Path, Set<String>> keyed = uses(NAMED_INDIVIDUALLY);

        // then
        assertThat(keyed)
                .as("this rule proves nothing unless the repository handles keys somewhere")
                .isNotEmpty();
        keyed.forEach((file, tokens) -> tokens.forEach(token -> assertThat(entries)
                .as("%s handles a key through %s, so an entry has to name that file rather than"
                        + " match it with a pattern", file, token)
                .anyMatch(entry -> namesExactly(entry, file) && claims(entry, token))));
    }

    // An entry naming nothing is an inventory describing a past release.
    @Test
    void givenTheInventory_whenItsLocationsAreRead_thenEachOneNamesSomething() throws IOException {
        // given
        Set<Path> present = new TreeSet<>();
        for (String surface : SURFACES) {
            present.addAll(filesMatching(Path.of(surface), Pattern.compile("x^")).keySet());
        }

        // when / then
        assertThat(locations()).allSatisfy(location -> assertThat(present)
                .as("%s is named by the inventory and matches no file", location)
                .anyMatch(glob(location)::matches));
    }

    @Test
    void givenEveryEntry_whenItIsRead_thenItAnswersTheLifecycleQuestions() throws IOException {
        // when / then
        for (JsonNode item : entries()) {
            assertThat(item.propertyNames())
                    .as("entry %s", item.get("id").asText())
                    .contains("id", "purpose", "algorithm", "class", "owner", "storageBoundary",
                            "permittedUse", "rotation", "revocation", "recovery", "retirement",
                            "evidence", "detects", "locations");
            assertThat(item.get("owner").asText())
                    .as("owner of %s names a role, never a person", item.get("id").asText())
                    .matches(ROLE);
        }
    }

    // A claim about which test proves an entry is worth nothing if that file does not exist.
    @Test
    void givenEveryEntry_whenItsEvidenceIsRead_thenEachFileItNamesExists() throws IOException {
        // when / then
        for (JsonNode item : entries()) {
            for (String named : item.get("evidence").asText().split(",")) {
                assertThat(Path.of(named.strip()))
                        .as("evidence named by %s", item.get("id").asText())
                        .exists();
            }
        }
    }

    // Both files are tracked and public. They record where material lives, never the material.
    @Test
    void givenWhatTheInventoryPublishes_whenItIsRead_thenItCarriesNoKeyMaterial()
            throws IOException {
        // when / then
        for (Path published : List.of(INVENTORY, POLICY)) {
            assertThat(Files.readString(published, StandardCharsets.UTF_8))
                    .as("%s must carry no material and no fingerprint of any", published)
                    .doesNotContain("BEGIN", "PRIVATE KEY", "-----")
                    .doesNotContainPattern("[A-Za-z0-9_-]{40,}")
                    .doesNotContainPattern("[A-Za-z0-9+/]{40,}={1,2}")
                    .doesNotContainPattern("(?i)([0-9a-f]{2}:){15,}[0-9a-f]{2}");
        }
    }

    @Test
    void givenProductionCryptographicUses_whenHashAlgorithmsAreScanned_thenOnlySha256AndProtocolSha1Remain()
            throws IOException {
        // when
        Map<Path, Set<String>> hashAlgorithms = uses(HASH_ALGORITHM);
        hashAlgorithms.keySet().removeIf(CryptographicInventoryTest::isTestSource);

        // then
        assertThat(hashAlgorithms).containsKey(BREACHED_PASSWORD_LOOKUP);
        hashAlgorithms.forEach((path, algorithms) -> algorithms.forEach(algorithm -> {
            if (path.equals(BREACHED_PASSWORD_LOOKUP)) {
                assertThat(algorithm).isEqualToIgnoringCase(
                        "MessageDigest.getInstance(\"SHA-1\")");
            } else {
                assertThat(algorithm).as("hash selected by %s", path)
                        .matches("(?i)(MessageDigest\\.getInstance\\(\"SHA-256\"\\)"
                                + "|createHash\\([\"']sha256[\"']\\)|openssl\\s+dgst\\s+-sha256)");
            }
        }));
    }

    @Test
    void givenANonGuessableCredential_whenItsGeneratorIsRead_thenItHasAtLeast128BitsFromSecureRandom()
            throws IOException {
        // given
        String source = readable(CREDENTIAL_ISSUER);
        Matcher bytes = CREDENTIAL_BYTES.matcher(source);

        // when / then
        assertThat(bytes.find()).as("the issued credential declares its entropy bytes").isTrue();
        assertThat(Integer.parseInt(bytes.group(1))).isGreaterThanOrEqualTo(16);
        assertThat(source).contains("new SecureRandom()", "random.nextBytes(bytes)");
    }

    @Test
    void givenTheShippedApplication_whenPasswordBasedKeyDerivationIsScanned_thenTheControlRemainsNotApplicable()
            throws IOException {
        // when
        Map<Path, Set<String>> passwordKeyDerivation = uses(PASSWORD_KEY_DERIVATION);
        passwordKeyDerivation.keySet().removeIf(CryptographicInventoryTest::isTestSource);

        // then
        assertThat(passwordKeyDerivation).isEmpty();
    }

    private static boolean covers(JsonNode entry, Path file) {
        for (JsonNode location : entry.get("locations")) {
            if (glob(location.asText()).matches(file)) {
                return true;
            }
        }
        return false;
    }

    private static boolean namesExactly(JsonNode entry, Path file) {
        for (JsonNode location : entry.get("locations")) {
            if (!location.asText().contains("*") && Path.of(location.asText()).equals(file)) {
                return true;
            }
        }
        return false;
    }

    private static boolean claims(JsonNode entry, String token) {
        for (JsonNode detected : entry.get("detects")) {
            if (detected.asText().equals(token)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isTestSource(Path path) {
        String name = path.getFileName().toString();
        return name.contains(".test.") || name.contains(".spec.");
    }

    private static PathMatcher glob(String location) {
        return FileSystems.getDefault().getPathMatcher("glob:" + location);
    }

    private static Set<String> locations() throws IOException {
        Set<String> locations = new HashSet<>();
        for (JsonNode item : entries()) {
            item.get("locations").forEach(location -> locations.add(location.asText()));
        }
        return locations;
    }

    private static List<JsonNode> entries() throws IOException {
        List<JsonNode> entries = new ArrayList<>();
        new ObjectMapper().readTree(INVENTORY.toFile()).get("entries").forEach(entries::add);
        return entries;
    }

    private static Map<Path, Set<String>> uses(Pattern pattern) throws IOException {
        Map<Path, Set<String>> uses = new TreeMap<>();
        for (String surface : SURFACES) {
            uses.putAll(filesMatching(Path.of(surface), pattern));
        }
        uses.values().removeIf(Set::isEmpty);
        return uses;
    }

    // A screenshot is not source, and decoding it as text throws rather than finding nothing.
    private static String readable(Path file) throws IOException {
        return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    }

    private static Map<Path, Set<String>> filesMatching(Path root, Pattern pattern)
            throws IOException {
        Map<Path, Set<String>> matches = new TreeMap<>();
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                if (file.toString().endsWith(DOCUMENTATION) || file.equals(DATA)) {
                    continue;
                }
                Set<String> tokens = new TreeSet<>();
                Matcher matcher = pattern.matcher(readable(file));
                while (matcher.find()) {
                    tokens.add(matcher.group());
                }
                matches.put(file, tokens);
            }
        }
        return matches;
    }
}
