package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MfaSessionContractTest extends AbstractIntegrationTest {
    @LocalServerPort private int port;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaTotpRepository totp;
    @Autowired private Clock clock;
    @Autowired private ObjectMapper json;
    private final CookieManager cookies = new CookieManager();
    private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();

    @ParameterizedTest
    @ValueSource(strings = {"anonymous", "password-only", "pending", "complete"})
    void givenAnyMfaSessionPhase_whenReadingTheNativeResponse_thenCapabilitiesAreBooleansWithoutPendingPrivileges(
            String phase) throws Exception {
        // given
        Person jane = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        var holder = new UserAccount(jane, "doe.jane", passwords.encode("correct-horse"), Set.of(Role.MEMBER), "en");
        holder.enable();
        var account = accounts.save(holder).getId();
        boolean enrolled = phase.equals("pending") || phase.equals("complete");
        byte[] secret = enrolled ? totp.begin(account) : null;
        if (enrolled) {
            assertThat(totp.confirm(account, TotpCodes.code(secret, clock.instant().minusSeconds(30)))).isTrue();
        }
        assertThat(send("GET", "/api/session", "", "application/json").statusCode()).isEqualTo(200);
        if (!phase.equals("anonymous")) {
            var password = send("POST", "/api/session", "username=doe.jane&password=correct-horse",
                    "application/x-www-form-urlencoded");
            assertThat(password.statusCode()).as(password.body()).isEqualTo(enrolled ? 202 : 200);
        }
        if (phase.equals("complete")) {
            var proof = send("POST", "/api/session/mfa",
                    "{\"code\":\"" + TotpCodes.code(secret, clock.instant()) + "\"}", "application/json");
            assertThat(proof.statusCode()).as(proof.body()).isEqualTo(200);
        }

        // when
        var response = send("GET", "/api/session", "", "application/json");
        JsonNode status = json.readTree(response.body());

        // then
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        for (String field : new String[]{"mfaRequired", "mfaEnabled", "totpAvailable", "webauthnAvailable"}) {
            assertThat(status.path(field).isBoolean()).as("%s exposes a boolean %s", phase, field).isTrue();
        }
        boolean authenticated = phase.equals("password-only") || phase.equals("complete");
        assertThat(status.path("authenticated").asBoolean()).isEqualTo(authenticated);
        assertThat(status.path("mfaRequired").asBoolean()).isEqualTo(phase.equals("pending"));
        assertThat(status.path("mfaEnabled").asBoolean()).isEqualTo(phase.equals("complete"));
        assertThat(status.path("totpAvailable").asBoolean()).isEqualTo(enrolled);
        assertThat(status.path("webauthnAvailable").asBoolean()).isFalse();
        if (authenticated) {
            assertThat(status.path("username").asString()).isEqualTo("doe.jane");
            assertThat(status.path("roles").size()).isEqualTo(1);
        } else {
            assertThat(status.path("username").isNull() || status.path("username").isMissingNode()).isTrue();
            assertThat(status.path("roles").size()).isZero();
        }
    }

    private HttpResponse<String> send(String method, String route, String body, String contentType) throws Exception {
        String token = cookies.getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(java.net.HttpCookie::getValue).findFirst().orElse("");
        return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + route))
                .header("Content-Type", contentType).header("X-XSRF-TOKEN", token)
                .method(method, HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
}
