package org.courtside;

import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class CryptographicStrengthTest {

    private static final Path INVENTORY = Path.of("security/cryptographic-inventory.json");
    private static final Path MAIL_CONFIGURATION = Path.of("deploy/mail/base.ndjson");

    private static final int POLICY_BITS = 128;
    private static final int BITS_PER_BYTE = 8;

    // An identifier answers to uniqueness rather than to secrecy, which is why the minimum below
    // does not reach it. docs/cryptographic-inventory.md says what the classes separate.
    private static final String WITHOUT_A_MINIMUM = "identifier";

    private static final Set<String> IMPLEMENTATIONS = Set.of("java-runtime", "bouncy-castle",
            "spring-security", "web-crypto", "node-crypto", "openssl", "sigstore", "stalwart",
            "caddy", "postgresql-jdbc");

    private static final Set<String> DECIDERS = Set.of("repository", "spring-security", "sigstore",
            "stalwart", "caddy", "club-operator", "have-i-been-pwned");

    // What each implementation this test can start actually computes, proved by the probes below
    // rather than asserted here.
    private static final Map<String, Set<String>> EXERCISED = Map.of(
            "java-runtime", Set.of("SHA-256", "SHA-1", "SecureRandom", "UUIDv4"),
            "bouncy-castle", Set.of("argon2id"),
            "spring-security", Set.of("platform-provided"));

    private static final String RUNTIME_MODULE = "java.base";

    private static final Set<String> COLLISION_RESISTANT = Set.of("SHA-256", "SHA-384", "SHA-512");

    private static final List<String> SURFACES = List.of("src/main/java", "src/main/resources",
            "src/test/java", "tools", "frontend/src", "frontend/e2e", ".github/workflows", "deploy");

    private static final Pattern KEY_GENERATION = Pattern.compile(
            "-newkey|genrsa|genpkey|generateKeyPair|KeyPairGenerator");
    private static final Pattern KEY_PARAMETERS = Pattern.compile(
            "-newkey\"?,?\\s*\"?(rsa:\\d+|ec)|ec_paramgen_curve:(P-\\d+)"
                    + "|rsa_keygen_bits:(\\d+)|modulusLength\"?\\s*:\\s*(\\d+)");

    // These two describe cryptography rather than perform it, and their own patterns name what they
    // are looking for. docs/cryptographic-inventory.md skips documentation for the same reason.
    private static final Set<Path> POLICY = Set.of(
            Path.of("src/test/java/org/courtside/CryptographicInventoryTest.java"),
            Path.of("src/test/java/org/courtside/CryptographicStrengthTest.java"));
    private static final Pattern HARNESS_DRAW = Pattern.compile("randomBytes\\((\\d+)\\)");
    private static final Pattern ARGON2_PARAMETERS = Pattern.compile("m=(\\d+),t=(\\d+),p=(\\d+)");

    private record Literal(String entry, Path source, Pattern pattern) { }

    private static final List<Literal> LITERALS = List.of(
            new Literal("password-hashing",
                    Path.of("src/main/java/org/courtside/identity/internal/SecurityConfiguration.java"),
                    Pattern.compile("HASH_LENGTH_IN_BYTES\\s*=\\s*(\\d+)")),
            new Literal("issued-credential",
                    Path.of("src/main/java/org/courtside/identity/internal/AccountCredentialIssuer.java"),
                    Pattern.compile("CREDENTIAL_BYTES\\s*=\\s*(\\d+)")),
            new Literal("unusable-password",
                    Path.of("src/main/java/org/courtside/identity/internal/UnusablePassword.java"),
                    Pattern.compile("PLAINTEXT_BYTES\\s*=\\s*(\\d+)")),
            new Literal("session-identifier",
                    Path.of("src/main/java/org/courtside/identity/internal/SecureRandomSessionIdGenerator.java"),
                    Pattern.compile("IDENTIFIER_BYTES\\s*=\\s*(\\d+)")),
            new Literal("account-session-revocation-handle",
                    Path.of("src/main/java/org/courtside/identity/internal/AccountSessionService.java"),
                    Pattern.compile("copyOf\\(digest,\\s*(\\d+)\\)")),
            new Literal("idempotency-key", Path.of("frontend/src/api/idempotency.ts"),
                    Pattern.compile("Uint8Array\\((\\d+)\\)")));

    @Test
    void givenEveryEntry_whenItsImplementationIsRead_thenItNamesAMaintainedProvider()
            throws IOException {
        // when / then
        for (JsonNode entry : entries()) {
            assertThat(entry.propertyNames()).as("entry %s", id(entry)).contains("implementation");
            assertThat(entry.get("implementation").asText())
                    .as("%s names an implementation this repository has reviewed; a new one is a"
                            + " decision rather than a spelling", id(entry))
                    .isIn(IMPLEMENTATIONS);
        }
    }

    @Test
    void whenTheNamedImplementationsAreExercised_thenEachOneIsTheProviderTheInventoryClaims()
            throws IOException, NoSuchAlgorithmException {
        // when
        List<String> providers = List.of(providerModuleOf("SHA-256"), providerModuleOf("SHA-1"),
                new SecureRandom().getProvider().getClass().getModule().getName());

        // then
        assertThat(providers).as("the JDK's own digests and randomness answer for java-runtime")
                .containsOnly(RUNTIME_MODULE);
        assertThat(UUID.randomUUID().version()).as("the JDK draws a version-4 UUID").isEqualTo(4);
        assertThat(UUID.fromString(csrfToken()).version())
                .as("Spring Security issues the CSRF token as a version-4 UUID").isEqualTo(4);
        bouncyCastleRecomputesTheShippedHash();
        for (JsonNode entry : entries()) {
            Set<String> exercised = EXERCISED.get(entry.get("implementation").asText());
            if (exercised == null) {
                continue;
            }
            assertThat(entry.get("algorithm").asText())
                    .as("%s claims %s, which computes only %s here", id(entry),
                            entry.get("implementation").asText(), exercised)
                    .isIn(exercised);
            assertThat(locationsOf(entry))
                    .as("%s claims an implementation this runtime holds, so it has to name Java"
                            + " that reaches it", id(entry))
                    .anyMatch(location -> location.endsWith(".java"));
        }
    }

    @Test
    void givenEveryEntry_whenItsStrengthIsRead_thenTheRepositorySelectedOnesReachThePolicy()
            throws IOException {
        // when / then
        for (JsonNode entry : entries()) {
            assertThat(entry.propertyNames()).as("entry %s", id(entry)).contains("strength");
            JsonNode strength = entry.get("strength");
            assertThat(strength.get("decidedBy").asText())
                    .as("%s says who decides its strength", id(entry)).isIn(DECIDERS);
            assertThat(strength.get("basis").asText())
                    .as("%s says what its strength rests on", id(entry)).isNotBlank();
            if ("repository".equals(strength.get("decidedBy").asText())) {
                assertThat(strength.propertyNames())
                        .as("%s is selected here, so it states its bits", id(entry))
                        .contains("bits");
                if (!WITHOUT_A_MINIMUM.equals(entry.get("class").asText())) {
                    assertThat(strength.get("bits").asInt())
                            .as("%s protects something, so it reaches the policy", id(entry))
                            .isGreaterThanOrEqualTo(POLICY_BITS);
                }
            } else {
                assertThat(strength.propertyNames())
                        .as("%s is decided elsewhere, so it states no bits of its own", id(entry))
                        .doesNotContain("bits");
            }
        }
    }

    @Test
    void whenTheStrengthBearingSourceIsRead_thenTheRecordedBitsAreTheOnesItDraws()
            throws IOException {
        // when / then
        for (Literal literal : LITERALS) {
            Matcher found = literal.pattern().matcher(read(literal.source()));
            assertThat(found.find())
                    .as("%s draws its strength from a literal in %s", literal.entry(),
                            literal.source())
                    .isTrue();
            assertThat(bitsOf(literal.entry()))
                    .as("%s records what %s draws", literal.entry(), literal.source())
                    .isEqualTo(Integer.parseInt(found.group(1)) * BITS_PER_BYTE);
        }
        assertThat(bitsOf("harness-random-fixture"))
                .as("the harness records its smallest draw")
                .isEqualTo(smallest(HARNESS_DRAW) * BITS_PER_BYTE);
    }

    @Test
    void givenEverySignatureAndIntegrityPath_whenItsHashIsRead_thenItIsCollisionResistant()
            throws IOException {
        // given
        Set<String> dkim = enabledDkimAlgorithms();

        // when / then
        assertThat(dkim)
                .as("the reference deployment signs with these and with no SHA-1 variant")
                .containsExactlyInAnyOrder("Dkim1Ed25519Sha256", "Dkim1RsaSha256");
        for (JsonNode entry : entries()) {
            if (!Set.of("signing", "integrity").contains(entry.get("class").asText())) {
                continue;
            }
            if ("repository".equals(entry.get("strength").get("decidedBy").asText())) {
                assertThat(entry.get("algorithm").asText())
                        .as("%s signs or verifies here, so it names a collision-resistant hash",
                                id(entry))
                        .isIn(COLLISION_RESISTANT);
            }
        }
        String recorded = basisOf("mail-dkim");
        for (String algorithm : dkim) {
            assertThat(recorded)
                    .as("the DKIM entry names every algorithm the reference deployment enables")
                    .contains(algorithm);
        }
    }

    @Test
    void givenEveryGeneratedKeyPair_whenItsParametersAreRead_thenTheyMeetThePolicy()
            throws IOException {
        // when
        Map<Path, Set<String>> generating = matches(KEY_GENERATION);
        Map<Path, Set<String>> parameters = matches(KEY_PARAMETERS);

        // then
        assertThat(generating).as("this rule proves nothing unless a key pair is generated somewhere")
                .isNotEmpty();
        assertThat(generating.keySet())
                .as("a key pair whose parameters this policy cannot read is one nobody decided")
                .isSubsetOf(parameters.keySet());
        int weakest = Integer.MAX_VALUE;
        for (Map.Entry<Path, Set<String>> file : parameters.entrySet()) {
            for (String specification : file.getValue()) {
                int bits = strengthOf(specification);
                assertThat(bits).as("%s generates %s", file.getKey(), specification)
                        .isGreaterThanOrEqualTo(POLICY_BITS);
                weakest = Math.min(weakest, bits);
            }
        }
        assertThat(bitsOf("harness-test-certificate"))
                .as("the harness certificate records the weakest key pair a run generates")
                .isEqualTo(weakest);
    }

    private static String providerModuleOf(String algorithm) throws NoSuchAlgorithmException {
        return MessageDigest.getInstance(algorithm).getProvider().getClass().getModule().getName();
    }

    private static String csrfToken() {
        return CookieCsrfTokenRepository.withHttpOnlyFalse()
                .generateToken(new MockHttpServletRequest()).getToken();
    }

    private static void bouncyCastleRecomputesTheShippedHash() throws IOException {
        JsonNode chosen = entry("password-hashing").get("parameters");
        String password = "correct horse battery staple";
        String encoded = new Argon2PasswordEncoder(chosen.get("saltBytes").asInt(),
                chosen.get("hashBytes").asInt(), chosen.get("parallelism").asInt(),
                chosen.get("memoryKibibytes").asInt(), chosen.get("iterations").asInt())
                .encode(password);
        String[] fields = encoded.split("\\$");
        Matcher cost = ARGON2_PARAMETERS.matcher(fields[3]);
        assertThat(cost.find()).as("the shipped encoding names the cost it was written at").isTrue();
        Argon2BytesGenerator generator = new Argon2BytesGenerator();
        generator.init(new Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withSalt(Base64.getDecoder().decode(fields[4]))
                .withMemoryAsKB(Integer.parseInt(cost.group(1)))
                .withIterations(Integer.parseInt(cost.group(2)))
                .withParallelism(Integer.parseInt(cost.group(3)))
                .build());
        byte[] recomputed = new byte[chosen.get("hashBytes").asInt()];
        generator.generateBytes(password.getBytes(StandardCharsets.UTF_8), recomputed);
        assertThat(recomputed)
                .as("Bouncy Castle recomputes the Argon2id hash the shipped encoder writes")
                .isEqualTo(Base64.getDecoder().decode(fields[5]));
    }

    // NIST SP 800-57 part 1, table 2: what a modulus or a curve is worth in bits of security.
    private static int strengthOf(String specification) {
        if (!specification.startsWith("P-") && !specification.startsWith("rsa:")) {
            return 0;
        }
        if (specification.startsWith("P-")) {
            return Integer.parseInt(specification.substring(2)) / 2;
        }
        int modulus = Integer.parseInt(specification.substring("rsa:".length()));
        if (modulus >= 15360) {
            return 256;
        }
        if (modulus >= 7680) {
            return 192;
        }
        if (modulus >= 3072) {
            return 128;
        }
        return modulus >= 2048 ? 112 : 80;
    }

    private static Set<String> enabledDkimAlgorithms() throws IOException {
        Set<String> enabled = new TreeSet<>();
        List<JsonNode> managed = new ArrayList<>();
        ObjectMapper mapper = new ObjectMapper();
        for (String line : Files.readAllLines(MAIL_CONFIGURATION, StandardCharsets.UTF_8)) {
            if (!line.isBlank()) {
                collect(mapper.readTree(line), managed);
            }
        }
        assertThat(managed).as("the reference deployment manages DKIM for at least one domain")
                .isNotEmpty();
        for (JsonNode algorithms : managed) {
            algorithms.propertyNames().forEach(name -> {
                if (algorithms.get(name).asBoolean()) {
                    enabled.add(name);
                }
            });
        }
        return enabled;
    }

    private static void collect(JsonNode node, List<JsonNode> managed) {
        if (node.has("dkimManagement") && node.get("dkimManagement").has("algorithms")) {
            managed.add(node.get("dkimManagement").get("algorithms"));
        }
        node.values().forEach(child -> collect(child, managed));
    }

    private static int smallest(Pattern pattern) throws IOException {
        int smallest = Integer.MAX_VALUE;
        for (Set<String> found : matches(pattern).values()) {
            for (String draw : found) {
                smallest = Math.min(smallest, Integer.parseInt(draw));
            }
        }
        return smallest;
    }

    private static int bitsOf(String id) throws IOException {
        return entry(id).get("strength").get("bits").asInt();
    }

    private static String basisOf(String id) throws IOException {
        return entry(id).get("strength").get("basis").asText();
    }

    private static List<String> locationsOf(JsonNode entry) {
        List<String> locations = new ArrayList<>();
        entry.get("locations").forEach(location -> locations.add(location.asText()));
        return locations;
    }

    private static String id(JsonNode entry) {
        return entry.get("id").asText();
    }

    private static JsonNode entry(String id) throws IOException {
        return entries().stream().filter(entry -> id(entry).equals(id)).findFirst().orElseThrow();
    }

    private static List<JsonNode> entries() throws IOException {
        List<JsonNode> entries = new ArrayList<>();
        new ObjectMapper().readTree(INVENTORY.toFile()).get("entries").forEach(entries::add);
        return entries;
    }

    private static String captured(Matcher matcher) {
        for (int group = 1; group <= matcher.groupCount(); group++) {
            if (matcher.group(group) != null) {
                return matcher.group(group);
            }
        }
        return matcher.group();
    }

    private static String read(Path file) throws IOException {
        return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    }

    private static Map<Path, Set<String>> matches(Pattern pattern) throws IOException {
        Map<Path, Set<String>> found = new TreeMap<>();
        for (String surface : SURFACES) {
            try (Stream<Path> files = Files.walk(Path.of(surface))) {
                for (Path file : files.filter(Files::isRegularFile).toList()) {
                    if (POLICY.contains(file)) {
                        continue;
                    }
                    Set<String> tokens = new TreeSet<>();
                    Matcher matcher = pattern.matcher(read(file));
                    while (matcher.find()) {
                        tokens.add(captured(matcher));
                    }
                    if (!tokens.isEmpty()) {
                        found.put(file, tokens);
                    }
                }
            }
        }
        return found;
    }
}
