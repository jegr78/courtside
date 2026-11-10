package org.courtside.payment;

import com.sun.net.httpserver.HttpServer;
import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Role;
import org.courtside.identity.testfixture.IdentityTestFixture;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.WebApplicationContext;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(OutputCaptureExtension.class)
class PayPalSettingsTest extends AbstractIntegrationTest {

    private static final String SECRET = "paypal-secret-value-1";
    private static final String NEW_SECRET = "paypal-secret-value-2";
    private static final List<String> CALLS = new CopyOnWriteArrayList<>();
    private static volatile int answerStatus = 200;
    private static volatile String answerBody = "{\"access_token\":\"token\",\"token_type\":\"Bearer\"}";
    private static final HttpServer PAYPAL = paypal();

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private UserDetailsService userDetails;
    @Autowired
    private IdentityTestFixture identity;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private Clock clock;
    @Autowired
    private PlatformTransactionManager transactions;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void endpoints(DynamicPropertyRegistry registry) {
        String base = "http://127.0.0.1:" + PAYPAL.getAddress().getPort();
        registry.add("courtside.payment.paypal.sandbox-endpoint", () -> base + "/sandbox");
        registry.add("courtside.payment.paypal.live-endpoint", () -> base + "/live");
    }

    @AfterAll
    static void stop() {
        PAYPAL.stop(0);
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
        CALLS.clear();
        answerStatus = 200;
        answerBody = "{\"access_token\":\"token\",\"token_type\":\"Bearer\"}";
        identity.createEnabledAccount(identity.createPerson("Richard", "Miles", "richard.miles@example.org"),
                "miles.richard", Set.of(Role.MEMBER, Role.TREASURER));
        identity.createEnabledAccount(identity.createPerson("Mary", "Major", "mary.major@example.org"),
                "major.mary", Set.of(Role.ADMIN));
        identity.createEnabledAccount(identity.createPerson("Jane", "Doe", "jane.doe@example.org"),
                "doe.jane", Set.of(Role.MEMBER));
    }

    @Test
    void givenATreasurer_whenTheyStoreCredentials_thenTheSettingsShowSinceWhenButNeverTheSecret(CapturedOutput output)
            throws Exception {
        // when
        String saved = save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, SECRET), true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientId").value("client-sandbox-1"))
                .andExpect(jsonPath("$.environment").value("SANDBOX"))
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.secretStoredAt").value(clock.instant().toString()))
                .andReturn().getResponse().getContentAsString();

        // then
        String read = mockMvc.perform(get("/api/treasury/paypal").with(user(userDetails.loadUserByUsername("major.mary"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientId").value("client-sandbox-1"))
                .andExpect(jsonPath("$.secretStoredAt").value(clock.instant().toString()))
                .andReturn().getResponse().getContentAsString();
        assertThat(saved + read).as("no response carries the secret").doesNotContain(SECRET);
        assertThat(storedCiphertext()).as("the database holds only ciphertext").doesNotContain(SECRET)
                .doesNotContain(Base64.getEncoder().encodeToString(SECRET.getBytes(StandardCharsets.UTF_8)));
        assertThat(audit("payment.paypal.settings.changed"))
                .as("the audit names what changed, never the secret or the client id")
                .singleElement().asString()
                .contains("\"secretReplaced\": true").contains("\"enabled\": true").contains("SANDBOX")
                .doesNotContain(SECRET).doesNotContain("client-sandbox-1");
        check("miles.richard").andExpect(jsonPath("$.outcome").value("OK"));
        assertThat(output.getAll()).as("no log line carries the secret").doesNotContain(SECRET);
    }

    @Test
    void givenNoRecentProof_whenTheTreasurerStoresCredentials_thenTheyMustProveItFirst() throws Exception {
        // when / then
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, SECRET), false)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(stored()).isZero();
    }

    @Test
    void givenNoStoredSecret_whenSwitchingPayPalOnWithoutOne_thenTheSecretIsRequired() throws Exception {
        // when / then
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, null), true)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:paypal-secret-required"))
                .andExpect(jsonPath("$.violations[0].code").value("payment.paypal.secretRequired"));
        assertThat(stored()).isZero();
        assertThat(audit("payment.paypal.settings.changed")).isEmpty();
    }

    @Test
    void givenNoStoredSecret_whenSavingTheClientIdWithPayPalOff_thenItIsKeptAndThereIsNothingToCheck()
            throws Exception {
        // when
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", false, null), true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientId").value("client-sandbox-1"))
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.secretStoredAt").doesNotExist());

        // then
        check("miles.richard").andExpect(jsonPath("$.outcome").value("NOT_CONFIGURED"));
        assertThat(CALLS).isEmpty();
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, null), true)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:paypal-secret-required"));
        assertThat(jdbc.sql("SELECT enabled FROM paypal_settings").query(Boolean.class).single())
                .as("PayPal stays off without a secret").isFalse();
    }

    @Test
    void givenStoredCredentials_whenSavingWithoutASecret_thenTheStoredSecretStaysInUse() throws Exception {
        // given
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", false, SECRET), true).andExpect(status().isOk());
        jdbc.sql("UPDATE paypal_settings SET secret_stored_at = '2026-05-01T08:00:00Z'").update();
        String ciphertext = storedCiphertext();

        // when
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, null), true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.secretStoredAt").value("2026-05-01T08:00:00Z"));

        // then
        assertThat(storedCiphertext()).isEqualTo(ciphertext);
        check("miles.richard").andExpect(jsonPath("$.outcome").value("OK"));
        assertThat(CALLS).as("the sandbox is asked with the kept secret")
                .containsExactly("/sandbox/v1/oauth2/token " + basic("client-sandbox-1", SECRET)
                        + " grant_type=client_credentials");
        assertThat(audit("payment.paypal.settings.changed")).anySatisfy(payload -> assertThat(payload)
                .contains("\"secretReplaced\": false").contains("\"clientIdChanged\": false"));
    }

    @Test
    void givenStoredCredentials_whenTheClientIdOrEnvironmentChangesWithoutASecret_thenANewSecretIsRequired()
            throws Exception {
        // given
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", false, SECRET), true).andExpect(status().isOk());
        String ciphertext = storedCiphertext();

        // when / then
        save("miles.richard", settings("client-live-1", "SANDBOX", false, null), true)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.violations[0].code").value("payment.paypal.secretRequired"));
        save("miles.richard", settings("client-sandbox-1", "LIVE", false, null), true)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.violations[0].code").value("payment.paypal.secretRequired"));
        assertThat(jdbc.sql("SELECT client_id || ' ' || environment FROM paypal_settings").query(String.class).single())
                .as("a stored secret never moves to other credentials").isEqualTo("client-sandbox-1 SANDBOX");
        assertThat(storedCiphertext()).isEqualTo(ciphertext);
    }

    @Test
    void givenStoredCredentials_whenTheSecretIsReplaced_thenTheCheckSendsTheNewOne() throws Exception {
        // given
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, SECRET), true).andExpect(status().isOk());
        String ciphertext = storedCiphertext();

        // when
        save("major.mary", settings("client-live-1", "LIVE", true, NEW_SECRET), true)
                .andExpect(status().isOk());

        // then
        assertThat(storedCiphertext()).isNotEqualTo(ciphertext);
        check("major.mary").andExpect(jsonPath("$.outcome").value("OK"));
        assertThat(CALLS).as("the live endpoint is asked with the new client id and secret")
                .containsExactly("/live/v1/oauth2/token " + basic("client-live-1", NEW_SECRET)
                + " grant_type=client_credentials");
    }

    @Test
    void givenAFirstSaveStillOpen_whenAnotherFirstSaveArrives_thenItWaitsAndUpdatesTheOneRow() throws Exception {
        // given
        CountDownLatch inserted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CompletableFuture<Void> first = CompletableFuture.runAsync(() -> new TransactionTemplate(transactions)
                .executeWithoutResult(status -> {
                    jdbc.sql("""
                            INSERT INTO paypal_settings (id, client_id, environment, enabled, updated_at)
                            VALUES (gen_random_uuid(), 'client-first', 'SANDBOX', false, now())
                            """).update();
                    inserted.countDown();
                    await(release);
                }));
        await(inserted);

        // when
        CompletableFuture<ResultActions> second = CompletableFuture.supplyAsync(() -> {
            try {
                return save("miles.richard", settings("client-sandbox-2", "SANDBOX", true, SECRET), true);
            } catch (Exception failed) {
                throw new IllegalStateException(failed);
            }
        });
        waitUntilASaveWaitsForALock();
        release.countDown();
        first.get(10, TimeUnit.SECONDS);

        // then
        second.get(10, TimeUnit.SECONDS).andExpect(status().isOk())
                .andExpect(jsonPath("$.clientId").value("client-sandbox-2"));
        assertThat(jdbc.sql("""
                SELECT client_id || ' ' || enabled || ' ' || (secret_ciphertext IS NOT NULL) FROM paypal_settings
                """).query(String.class).list()).containsExactly("client-sandbox-2 true true");
    }

    @Test
    void givenAWrongSecret_whenChecking_thenPayPalsReasonIsReported(CapturedOutput output) throws Exception {
        // given
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, SECRET), true).andExpect(status().isOk());
        answerStatus = 401;
        answerBody = "{\"error\":\"invalid_client\",\"error_description\":\"Client Authentication failed\"}";

        // when / then
        check("miles.richard")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("REJECTED"))
                .andExpect(jsonPath("$.providerReason").value("invalid_client: Client Authentication failed"));
        assertThat(output.getAll()).doesNotContain(SECRET);
    }

    @Test
    void givenNothingStored_whenChecking_thenThereIsNothingToCheck() throws Exception {
        // when / then
        check("miles.richard")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("NOT_CONFIGURED"))
                .andExpect(jsonPath("$.providerReason").doesNotExist());
        assertThat(CALLS).isEmpty();
    }

    @Test
    void givenStoredCredentials_whenRemoved_thenNothingRemainsAndPayPalIsOff() throws Exception {
        // given
        save("miles.richard", settings("client-sandbox-1", "SANDBOX", true, SECRET), true).andExpect(status().isOk());

        // when
        remove(false)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:recent-authentication-required"));
        assertThat(stored()).isOne();
        remove(true).andExpect(status().isNoContent());

        // then
        mockMvc.perform(get("/api/treasury/paypal").with(user(userDetails.loadUserByUsername("miles.richard"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientId").doesNotExist())
                .andExpect(jsonPath("$.secretStoredAt").doesNotExist())
                .andExpect(jsonPath("$.enabled").value(false));
        assertThat(stored()).isZero();
        assertThat(audit("payment.paypal.credentials.removed")).hasSize(1);
    }

    @Test
    void givenAMember_whenReadingOrChangingTheSettings_thenTheyAreRefused() throws Exception {
        // when / then
        mockMvc.perform(get("/api/treasury/paypal").with(user(userDetails.loadUserByUsername("doe.jane"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        save("doe.jane", settings("client-sandbox-1", "SANDBOX", true, SECRET), true)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:access-denied"));
        assertThat(stored()).isZero();
    }

    private ResultActions save(String username, String body, boolean recentlyProven) throws Exception {
        return mockMvc.perform(proven(put("/api/treasury/paypal")
                .with(user(userDetails.loadUserByUsername(username))).with(csrf())
                .contentType(MediaType.APPLICATION_JSON).content(body), recentlyProven));
    }

    private ResultActions remove(boolean recentlyProven) throws Exception {
        return mockMvc.perform(proven(delete("/api/treasury/paypal")
                .with(user(userDetails.loadUserByUsername("miles.richard"))).with(csrf()), recentlyProven));
    }

    private ResultActions check(String username) throws Exception {
        return mockMvc.perform(post("/api/treasury/paypal/check")
                .with(user(userDetails.loadUserByUsername(username))).with(csrf()));
    }

    private MockHttpServletRequestBuilder proven(MockHttpServletRequestBuilder request, boolean recentlyProven) {
        return recentlyProven ? request.sessionAttr("courtside.authenticated-at", clock.instant().toEpochMilli())
                : request;
    }

    private static String settings(String clientId, String environment, boolean enabled, String secret) {
        return "{\"clientId\":\"%s\",\"environment\":\"%s\",\"enabled\":%s%s}".formatted(clientId, environment,
                enabled, secret == null ? "" : ",\"secret\":\"" + secret + "\"");
    }

    private void waitUntilASaveWaitsForALock() throws InterruptedException {
        for (int attempt = 0; attempt < 200; attempt++) {
            boolean waiting = jdbc.sql("""
                    SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                        WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO paypal_settings%')
                    """).query(Boolean.class).single();
            if (waiting) return;
            Thread.sleep(25);
        }
        throw new AssertionError("the second save never waited for the first one's row");
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) throw new AssertionError("a latch was never released");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError("interrupted while waiting", interrupted);
        }
    }

    private long stored() {
        return jdbc.sql("SELECT count(*) FROM paypal_settings").query(Long.class).single();
    }

    private String storedCiphertext() {
        return jdbc.sql("SELECT secret_ciphertext FROM paypal_settings").query(String.class).single();
    }

    private List<String> audit(String type) {
        return jdbc.sql("SELECT payload::text FROM domain_event WHERE event_type = :type ORDER BY occurred_at")
                .param("type", type).query(String.class).list();
    }

    private static String basic(String clientId, String secret) {
        return "Basic " + Base64.getEncoder().encodeToString((clientId + ":" + secret)
                .getBytes(StandardCharsets.UTF_8));
    }

    private static HttpServer paypal() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                CALLS.add(exchange.getRequestURI().getPath() + " "
                        + exchange.getRequestHeaders().getFirst("Authorization") + " " + body);
                byte[] answer = answerBody.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(answerStatus, answer.length);
                exchange.getResponseBody().write(answer);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException unavailable) {
            throw new UncheckedIOException(unavailable);
        }
    }
}
