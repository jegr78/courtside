package org.courtside;

import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRpEntity;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialType;
import org.springframework.security.web.webauthn.management.ImmutablePublicKeyCredentialCreationOptionsRequest;
import org.springframework.security.web.webauthn.management.MapPublicKeyCredentialUserEntityRepository;
import org.springframework.security.web.webauthn.management.MapUserCredentialRepository;
import org.springframework.security.web.webauthn.management.Webauthn4JRelyingPartyOperations;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.GeneralSecurityException;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CryptographicStrengthTest {

    private static final Path INVENTORY = Path.of("security/cryptographic-inventory.json");
    private static final Path COMPOSE = Path.of("deploy/compose.stalwart.yaml");
    private static final Path MAIL_PLANS = Path.of("deploy/mail");
    private static final Path RESET_CODES = Path.of(
            "src/main/java/org/courtside/identity/internal/ResetCodes.java");
    private static final Pattern RESET_CODE_ALPHABET = Pattern.compile(
            "ALPHABET\\s*=\\s*\"([^\"]+)\"");
    private static final Pattern RESET_CODE_CHARACTERS = Pattern.compile(
            "CHARACTERS\\s*=\\s*(\\d+)");

    private static final int POLICY_BITS = 128;
    private static final int BITS_PER_BYTE = 8;

    // How far a key parameter may sit from the call that generates the key, in characters.
    private static final int WITHIN_THE_CALL = 200;

    // An identifier answers to uniqueness and a rate-bounded secret to the budget an attacker gets,
    // so neither answers to the minimum below. docs/cryptographic-inventory.md separates them.
    private static final Set<String> WITHOUT_A_MINIMUM = Set.of("identifier", "rate-bounded-secret");

    // A rate-bounded secret escapes the minimum on the strength of a literal in the code, so its
    // bits have to be ones this test recomputes rather than ones the entry may simply assert.
    private static final Set<String> RECOMPUTED = Set.of("password-reset-code", "mfa-totp",
            "mfa-recovery-code", "mfa-browser-authenticator");

    private static final Set<String> IMPLEMENTATIONS = Set.of("java-runtime", "bouncy-castle",
            "spring-security", "web-crypto", "node-crypto", "openssl", "sigstore", "stalwart",
            "caddy", "postgresql-jdbc");

    private static final Set<String> DECIDERS = Set.of("repository", "spring-security", "sigstore",
            "stalwart", "caddy", "club-operator", "have-i-been-pwned");

    // What each implementation this test can start actually computes, proved by the probes below
    // rather than asserted here.
    private static final Map<String, Set<String>> EXERCISED = Map.of(
            "java-runtime", Set.of("SHA-256", "SHA-1", "SecureRandom", "UUIDv4", "HMAC-SHA-1", "AES-256-GCM"),
            "bouncy-castle", Set.of("argon2id"),
            "spring-security", Set.of("platform-provided", "WebAuthn-COSE"));

    private static final String RUNTIME_MODULE = "java.base";

    private static final Set<String> COLLISION_RESISTANT = Set.of("SHA-256", "SHA-384", "SHA-512");
    private static final Set<String> SIGNS_OR_VERIFIES = Set.of("signing", "integrity");

    private static final Set<String> NOT_SOURCE = Set.of(".git", "node_modules", "target", "build",
            "dist", "coverage", "playwright-report", "test-results", "node");

    // Prose about generating a key is not a generated key, and the shipped password list carries a
    // hundred thousand words that no rule here is about.
    private static final String DOCUMENTATION = ".md";
    private static final Path DATA = Path.of("src/main/resources/security/common-passwords.txt");

    // Policy regexes and detector names describe calls without executing them.
    private static final Set<Path> POLICY = Set.of(INVENTORY,
            Path.of("src/test/java/org/courtside/CryptographicInventoryTest.java"),
            Path.of("src/test/java/org/courtside/CryptographicStrengthTest.java"));

    private static final Pattern KEY_GENERATION = Pattern.compile(
            "-newkey|genrsa|genpkey|ecparam|ssh-keygen|generateKeyPair|KeyPairGenerator"
                    + "|subtle\\.generateKey");
    private static final Pattern KEY_PARAMETERS = Pattern.compile(
            "-newkey\"?,?\\s*\"?(rsa:\\d+)|ec_paramgen_curve:(P-\\d+)"
                    + "|namedCurve\"?\\s*:\\s*\"(P-\\d+)\"|rsa_keygen_bits:(\\d+)"
                    + "|modulusLength\"?\\s*:\\s*(\\d+)|-b\\s+(\\d+)");
    private static final Pattern JAVA_EC_GENERATION = Pattern.compile(
            "(?:var|KeyPairGenerator)\\s+(\\w+)\\s*=\\s*KeyPairGenerator\\.getInstance\\(\"EC\"\\);\\s*"
                    + "\\1\\.initialize\\(new ECGenParameterSpec\\(\"(secp256r1)\"\\)\\);\\s*"
                    + "\\w+\\s*=\\s*\\1\\.generateKeyPair\\(\\)");
    private static final Pattern KEY_GENERATOR_IMPORT = Pattern.compile(
            "(?m)^import java\\.security\\.KeyPairGenerator;[ \\t]*$");
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
    void whenTheMfaProvidersAreExercised_thenTheyComputeTheAdvertisedPrimitives() throws GeneralSecurityException {
        // given
        byte[] secret = new byte[32];
        byte[] nonce = new byte[12];
        byte[] plaintext = "account-bound secret".getBytes(StandardCharsets.US_ASCII);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        Mac mac = Mac.getInstance("HmacSHA1");
        var operations = new Webauthn4JRelyingPartyOperations(new MapPublicKeyCredentialUserEntityRepository(),
                new MapUserCredentialRepository(), PublicKeyCredentialRpEntity.builder()
                        .id("courts.example.org").name("Example Tennis Club").build(), Set.of("https://courts.example.org"));

        // when
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(secret, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD("account".getBytes(StandardCharsets.US_ASCII));
        byte[] encrypted = cipher.doFinal(plaintext);
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(secret, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD("account".getBytes(StandardCharsets.US_ASCII));
        byte[] decrypted = cipher.doFinal(encrypted);
        byte[] hmacKey = new byte[20];
        java.util.Arrays.fill(hmacKey, (byte) 0x0b);
        mac.init(new SecretKeySpec(hmacKey, "HmacSHA1"));
        var options = operations.createPublicKeyCredentialCreationOptions(
                new ImmutablePublicKeyCredentialCreationOptionsRequest(
                        UsernamePasswordAuthenticationToken.authenticated("jane.doe", null, List.of())));

        // then
        assertThat(cipher.getProvider().getClass().getModule().getName()).isEqualTo(RUNTIME_MODULE);
        assertThat(mac.getProvider().getClass().getModule().getName()).isEqualTo(RUNTIME_MODULE);
        assertThat(decrypted).isEqualTo(plaintext);
        assertThat(encrypted).hasSize(plaintext.length + 16);
        assertThat(java.util.HexFormat.of().formatHex(mac.doFinal("Hi There".getBytes(StandardCharsets.US_ASCII))))
                .isEqualTo("b617318655057264e28bc0b6fb378c8ef146be00");
        assertThat(options.getRp().getId()).isEqualTo("courts.example.org");
        assertThat(options.getChallenge().getBytes()).isNotEmpty();
        assertThat(options.getPubKeyCredParams()).isNotEmpty().allSatisfy(parameter -> {
            assertThat(parameter.getType()).isEqualTo(PublicKeyCredentialType.PUBLIC_KEY);
            assertThat(parameter.getAlg()).isNotNull();
        });
    }

    @Test
    void whenTheMfaGeneratorsAreRead_thenTheInventoryRecordsTheirActualParameters() throws IOException {
        // given
        Path directory = Path.of("src/main/java/org/courtside/identity/internal");
        String totp = read(directory.resolve("TotpCodes.java"));
        String keyring = read(directory.resolve("MfaKeyRing.java"));
        String recovery = read(directory.resolve("MfaRecoveryCodes.java"));
        String reset = read(RESET_CODES);

        // when
        int secretBytes = literal(totp, "byte\\[\\] secret = new byte\\[(\\d+)\\]", "TOTP secret bytes");
        int decimalCodes = literal(totp, "truncated % ([0-9_]+)", "TOTP code space");
        int period = literal(totp, "getEpochSecond\\(\\) / (\\d+)", "TOTP period");
        int keyBytes = literal(keyring, "byte\\[\\] material = new byte\\[(\\d+)\\]", "MFA encryption key bytes");
        int nonceBytes = literal(keyring, "byte\\[\\] nonce = new byte\\[(\\d+)\\]", "MFA encryption nonce bytes");
        int tagBits = literal(keyring, "GCMParameterSpec\\((\\d+)", "MFA authentication tag bits");
        Matcher alphabet = RESET_CODE_ALPHABET.matcher(reset);
        assertThat(alphabet.find()).as("the shared code generator declares its alphabet").isTrue();
        int symbols = (int) alphabet.group(1).chars().distinct().count();
        int characters = literal(reset, "CHARACTERS\\s*=\\s*(\\d+)", "shared code length");
        int components = recovery.split("ResetCodes\\.generate\\(\\)", -1).length - 1;
        int recoveryBits = (int) Math.floor(characters * components * Math.log(symbols) / Math.log(2));

        // then
        JsonNode totpParameters = entry("mfa-totp").get("parameters");
        assertThat(totpParameters.get("secretBytes").asInt()).isEqualTo(secretBytes);
        assertThat(totpParameters.get("digits").asInt()).isEqualTo((int) Math.log10(decimalCodes));
        assertThat(totpParameters.get("periodSeconds").asInt()).isEqualTo(period);
        assertThat(bitsOf("mfa-totp")).isEqualTo((int) Math.floor(Math.log(decimalCodes) / Math.log(2)));
        JsonNode encryption = entry("mfa-secret-encryption").get("parameters");
        assertThat(encryption.get("keyBytes").asInt()).isEqualTo(keyBytes);
        assertThat(encryption.get("nonceBytes").asInt()).isEqualTo(nonceBytes);
        assertThat(encryption.get("authenticationTagBits").asInt()).isEqualTo(tagBits);
        assertThat(bitsOf("mfa-secret-encryption")).isEqualTo(Math.min(keyBytes * BITS_PER_BYTE, tagBits));
        JsonNode recoveryParameters = entry("mfa-recovery-code").get("parameters");
        assertThat(recoveryParameters.get("alphabetSymbols").asInt()).isEqualTo(symbols);
        assertThat(recoveryParameters.get("characters").asInt()).isEqualTo(characters * components);
        assertThat(bitsOf("mfa-recovery-code")).isEqualTo(recoveryBits);
        assertThat(totp).contains("Mac.getInstance(\"HmacSHA1\")");
        assertThat(keyring).contains("Cipher.getInstance(\"AES/GCM/NoPadding\")");
        JsonNode browserParameters = entry("mfa-browser-authenticator").get("parameters");
        for (String path : List.of("frontend/e2e/mfa-authenticator.ts", "tools/security-mfa-fixture.mjs")) {
            String fixture = read(Path.of(path));
            int fixtureCodes = literal(fixture, "% ([0-9_]+)", "fixture authenticator code space");
            int fixturePeriod = literal(fixture, "/ ([0-9_]+)\\) \\+", "fixture authenticator period");
            assertThat(browserParameters.get("digits").asInt()).isEqualTo((int) Math.log10(fixtureCodes));
            assertThat(browserParameters.get("periodMilliseconds").asInt()).isEqualTo(fixturePeriod);
            assertThat(bitsOf("mfa-browser-authenticator"))
                    .isEqualTo((int) Math.floor(Math.log(fixtureCodes) / Math.log(2)));
            assertThat(fixture).contains("createHmac(\"sha1\"");
        }
        String nativeFixture = read(Path.of("tools/security-mfa-fixture.mjs"));
        Matcher curve = Pattern.compile("namedCurve: \"(P-\\d+)\"").matcher(nativeFixture);
        assertThat(curve.find()).as("the native fixture declares its selected curve").isTrue();
        JsonNode fixtureParameters = entry("mfa-webauthn-fixture").get("parameters");
        assertThat(fixtureParameters.get("namedCurve").asText()).isEqualTo(curve.group(1));
        assertThat(bitsOf("mfa-webauthn-fixture")).isEqualTo(strengthOf(curve.group(1)));
        assertThat(fixtureParameters.get("credentialIdBytes").asInt())
                .isEqualTo(literal(nativeFixture, "const id = crypto\\.randomBytes\\((\\d+)\\)", "fixture credential id bytes"));
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
                if (!WITHOUT_A_MINIMUM.contains(entry.get("class").asText())) {
                    assertThat(strength.get("bits").asInt())
                            .as("%s protects something, so it reaches the policy", id(entry))
                            .isGreaterThanOrEqualTo(POLICY_BITS);
                }
                if ("rate-bounded-secret".equals(entry.get("class").asText())) {
                    assertThat(RECOMPUTED)
                            .as("%s escapes the minimum, so this test reads its bits from the code",
                                    id(entry))
                            .contains(id(entry));
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
    void whenTheResetCodeGeneratorIsRead_thenTheRecordedBitsAreTheOnesItDraws() throws IOException {
        // given
        String source = read(RESET_CODES);
        Matcher alphabet = RESET_CODE_ALPHABET.matcher(source);
        Matcher characters = RESET_CODE_CHARACTERS.matcher(source);

        // when
        assertThat(alphabet.find()).as("the reset code names the alphabet it draws from").isTrue();
        assertThat(characters.find()).as("the reset code names how many it draws").isTrue();
        int symbols = (int) alphabet.group(1).chars().distinct().count();
        int drawn = (int) Math.floor(Integer.parseInt(characters.group(1))
                * (Math.log(symbols) / Math.log(2)));

        // then
        assertThat(bitsOf("password-reset-code"))
                .as("the entry records what the generator draws")
                .isEqualTo(drawn);
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

    @Test
    void givenJavaEcKeyGeneration_whenItsCurveOrGeneratorBindingChanges_thenThePolicyRefusesIt() throws IOException {
        // given
        Path fixture = Path.of("src/test/java/org/courtside/identity/internal/WebAuthnAuthenticatorFixture.java");
        String source = read(fixture);

        // when / then
        assertThat(generatedKeyPairs(Map.of(fixture, source))).containsEntry(fixture + " Java EC secp256r1", 128);
        assertThatThrownBy(() -> generatedKeyPairs(Map.of(fixture, source.replace("secp256r1", "secp192r1"))))
                .isInstanceOf(AssertionError.class).hasMessageContaining("names no parameter");
        assertThatThrownBy(() -> generatedKeyPairs(Map.of(fixture, source.replace("generator.initialize", "other.initialize"))))
                .isInstanceOf(AssertionError.class).hasMessageContaining("names no parameter");
    }

    private static Map<String, Integer> generatedKeyPairs() throws IOException {
        return generatedKeyPairs(sources());
    }

    private static Map<String, Integer> generatedKeyPairs(Map<Path, String> sources) {
        Map<String, Integer> rated = new TreeMap<>();
        for (Map.Entry<Path, String> file : sources.entrySet()) {
            String source = KEY_GENERATOR_IMPORT.matcher(file.getValue()).replaceAll("");
            Matcher javaEc = JAVA_EC_GENERATION.matcher(source);
            while (javaEc.find()) {
                rated.put(file.getKey() + " Java EC " + javaEc.group(2), 128);
            }
            source = JAVA_EC_GENERATION.matcher(source).replaceAll("");
            Map.Entry<Path, String> remaining = Map.entry(file.getKey(), source);
            Matcher generation = KEY_GENERATION.matcher(source);
            while (generation.find()) {
                String call = source.substring(generation.start(), Math.min(
                        generation.start() + WITHIN_THE_CALL, source.length()));
                Matcher parameter = KEY_PARAMETERS.matcher(call);
                String where = where(remaining, generation) + " generates a key pair with "
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

    private static int literal(String source, String pattern, String name) {
        Matcher found = Pattern.compile(pattern).matcher(source);
        assertThat(found.find()).as("%s is declared in the production source", name).isTrue();
        return Integer.parseInt(found.group(1).replace("_", ""));
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
