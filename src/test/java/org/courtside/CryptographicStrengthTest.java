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
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
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

import static org.assertj.core.api.Assertions.assertThat;

class CryptographicStrengthTest {

    private static final Path INVENTORY = Path.of("security/cryptographic-inventory.json");
    private static final Path COMPOSE = Path.of("deploy/compose.yaml");
    private static final Path MAIL_PLANS = Path.of("deploy/mail");

    private static final int POLICY_BITS = 128;
    private static final int BITS_PER_BYTE = 8;

    // How far a key parameter may sit from the call that generates the key, in characters.
    private static final int WITHIN_THE_CALL = 200;

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
    private static final Set<String> SIGNS_OR_VERIFIES = Set.of("signing", "integrity");

    private static final Set<String> NOT_SOURCE = Set.of(".git", "node_modules", "target", "build",
            "dist", "coverage", "playwright-report", "test-results", "node");

    // Prose about generating a key is not a generated key, and the shipped password list carries a
    // hundred thousand words that no rule here is about.
    private static final String DOCUMENTATION = ".md";
    private static final Path DATA = Path.of("src/main/resources/security/common-passwords.txt");

    // Both carry the patterns below as literals, so a scan that read them would find its own words.
    // Neither generates a key or draws a random value.
    private static final Set<Path> POLICY = Set.of(
            Path.of("src/test/java/org/courtside/CryptographicInventoryTest.java"),
            Path.of("src/test/java/org/courtside/CryptographicStrengthTest.java"));

    private static final Pattern KEY_GENERATION = Pattern.compile(
            "-newkey|genrsa|genpkey|ecparam|ssh-keygen|generateKeyPair|KeyPairGenerator"
                    + "|subtle\\.generateKey");
    private static final Pattern KEY_PARAMETERS = Pattern.compile(
            "-newkey\"?,?\\s*\"?(rsa:\\d+)|ec_paramgen_curve:(P-\\d+)"
                    + "|namedCurve\"?\\s*:\\s*\"(P-\\d+)\"|rsa_keygen_bits:(\\d+)"
                    + "|modulusLength\"?\\s*:\\s*(\\d+)|-b\\s+(\\d+)");
    private static final Pattern HARNESS_DRAW = Pattern.compile("randomBytes\\((\\d+)\\)");
    private static final Pattern HARNESS_CREDENTIAL = Pattern.compile(
            "(?i)password\\s*=\\s*randomBytes\\((\\d+)\\)");
    private static final Pattern ARGON2_PARAMETERS = Pattern.compile("m=(\\d+),t=(\\d+),p=(\\d+)");
    private static final Pattern APPLIED_PLAN = Pattern.compile("/plan/([A-Za-z0-9_.-]+\\.ndjson)");

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

    private static Map<Path, String> scanned;

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
        Map<String, Integer> credentials = drawn(HARNESS_CREDENTIAL);
        assertThat(credentials)
                .as("a harness that generates no credential of its own would prove nothing here")
                .isNotEmpty();
        credentials.forEach((where, bytes) -> assertThat(bytes * BITS_PER_BYTE)
                .as("%s draws a credential, which reaches the policy whatever else the harness draws"
                        + " for a name", where)
                .isGreaterThanOrEqualTo(POLICY_BITS));
    }

    @Test
    void givenEverySignatureAndIntegrityPath_whenItsHashIsRead_thenItIsCollisionResistant()
            throws IOException {
        // given
        Set<String> dkim = enabledDkimAlgorithms();

        // when
        List<JsonNode> signing = entries().stream()
                .filter(entry -> SIGNS_OR_VERIFIES.contains(entry.get("class").asText())).toList();

        // then
        assertThat(dkim).as("the reference deployment signs with these and with no SHA-1 variant")
                .containsExactlyInAnyOrder("Dkim1Ed25519Sha256", "Dkim1RsaSha256");
        assertThat(signing).as("this rule proves nothing unless something here signs or verifies")
                .isNotEmpty();
        for (JsonNode entry : signing) {
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
        Map<String, Integer> generated = generatedKeyPairs();

        // then
        assertThat(generated).as("this rule proves nothing unless a key pair is generated somewhere")
                .isNotEmpty();
        generated.forEach((where, bits) -> assertThat(bits).as("%s", where)
                .isGreaterThanOrEqualTo(POLICY_BITS));
        assertThat(bitsOf("harness-test-certificate"))
                .as("the harness certificate records the weakest key pair a run generates")
                .isEqualTo(generated.values().stream().min(Integer::compare).orElseThrow());
    }

    private static Map<String, Integer> generatedKeyPairs() throws IOException {
        Map<String, Integer> rated = new TreeMap<>();
        for (Map.Entry<Path, String> file : sources().entrySet()) {
            Matcher generation = KEY_GENERATION.matcher(file.getValue());
            while (generation.find()) {
                String call = file.getValue().substring(generation.start(), Math.min(
                        generation.start() + WITHIN_THE_CALL, file.getValue().length()));
                Matcher parameter = KEY_PARAMETERS.matcher(call);
                String where = where(file, generation) + " generates a key pair with "
                        + generation.group();
                assertThat(parameter.find())
                        .as("%s, and names no parameter this policy can read", where).isTrue();
                rated.put(where + " " + captured(parameter), strengthOf(captured(parameter)));
            }
        }
        return rated;
    }

    private static String where(Map.Entry<Path, String> file, Matcher found) {
        return file.getKey() + ":" + (1 + file.getValue().substring(0, found.start()).chars()
                .filter(character -> character == '\n').count());
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
        if (specification.startsWith("P-")) {
            return Integer.parseInt(specification.substring(2)) / 2;
        }
        int modulus = Integer.parseInt(specification.startsWith("rsa:")
                ? specification.substring("rsa:".length()) : specification);
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
        Set<String> plans = new TreeSet<>();
        Matcher applied = APPLIED_PLAN.matcher(read(COMPOSE));
        while (applied.find()) {
            plans.add(applied.group(1));
        }
        assertThat(plans).as("the reference deployment applies at least one mail plan").isNotEmpty();
        List<JsonNode> managed = new ArrayList<>();
        ObjectMapper mapper = new ObjectMapper();
        for (String plan : plans) {
            for (String line : Files.readAllLines(MAIL_PLANS.resolve(plan), StandardCharsets.UTF_8)) {
                if (!line.isBlank()) {
                    collect(mapper.readTree(line), managed);
                }
            }
        }
        assertThat(managed).as("the reference deployment manages DKIM for at least one domain")
                .isNotEmpty();
        Set<String> enabled = new TreeSet<>();
        for (JsonNode algorithms : managed) {
            assertThat(algorithms.isObject())
                    .as("a domain manages DKIM without an algorithm set this policy can read")
                    .isTrue();
            algorithms.propertyNames().forEach(name -> {
                if (algorithms.get(name).asBoolean()) {
                    enabled.add(name);
                }
            });
        }
        return enabled;
    }

    private static void collect(JsonNode node, List<JsonNode> managed) {
        if (node.has("dkimManagement")) {
            managed.add(node.get("dkimManagement").path("algorithms"));
        }
        node.values().forEach(child -> collect(child, managed));
    }

    private static int smallest(Pattern pattern) throws IOException {
        return drawn(pattern).values().stream().min(Integer::compare).orElseThrow();
    }

    private static Map<String, Integer> drawn(Pattern pattern) throws IOException {
        Map<String, Integer> draws = new TreeMap<>();
        for (Map.Entry<Path, String> file : sources().entrySet()) {
            Matcher found = pattern.matcher(file.getValue());
            while (found.find()) {
                draws.put(where(file, found), Integer.parseInt(found.group(1)));
            }
        }
        return draws;
    }

    private static int bitsOf(String id) throws IOException {
        JsonNode strength = entry(id).get("strength");
        assertThat(strength.propertyNames()).as("%s states the bits it draws", id).contains("bits");
        return strength.get("bits").asInt();
    }

    private static String basisOf(String id) throws IOException {
        return entry(id).get("strength").get("basis").asText();
    }

    private static String captured(Matcher matcher) {
        for (int group = 1; group <= matcher.groupCount(); group++) {
            if (matcher.group(group) != null) {
                return matcher.group(group);
            }
        }
        return matcher.group();
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

    private static String read(Path file) throws IOException {
        return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    }

    private static synchronized Map<Path, String> sources() throws IOException {
        if (scanned != null) {
            return scanned;
        }
        Map<Path, String> sources = new TreeMap<>();
        Files.walkFileTree(Path.of("."), new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path directory, BasicFileAttributes ignored) {
                return NOT_SOURCE.contains(directory.getFileName().toString())
                        ? FileVisitResult.SKIP_SUBTREE : FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes ignored)
                    throws IOException {
                Path named = file.normalize();
                if (!named.toString().endsWith(DOCUMENTATION) && !named.equals(DATA)
                        && !POLICY.contains(named)) {
                    sources.put(named, read(named));
                }
                return FileVisitResult.CONTINUE;
            }
        });
        scanned = sources;
        return scanned;
    }
}
