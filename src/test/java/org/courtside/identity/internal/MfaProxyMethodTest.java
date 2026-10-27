package org.courtside.identity.internal;

import org.courtside.AbstractIntegrationTest;
import org.courtside.identity.Person;
import org.courtside.identity.PersonRepository;
import org.courtside.identity.Role;
import org.courtside.identity.UserAccount;
import org.courtside.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialCreationOptions;
import org.springframework.security.web.webauthn.api.PublicKeyCredentialRequestOptions;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.Testcontainers;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.images.builder.Transferable;

import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = {"courtside.public-url=https://courts.example.org",
        "spring.application.name=courtside-proxy-method-test"})
class MfaProxyMethodTest extends AbstractIntegrationTest {
    private static final String ORIGIN = "https://courts.example.org";
    @LocalServerPort private int port;
    @Autowired private PersonRepository people;
    @Autowired private UserAccountRepository accounts;
    @Autowired private PasswordEncoder passwords;
    @Autowired private MfaWebAuthnCodec codec;
    @Autowired private MfaWebAuthnCredentials credentials;
    private final CookieManager cookies = new CookieManager();
    private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
    private URI base;

    @Test
    void givenARealCredentialPatchRoute_whenQueryPassesThroughTheProxy_thenTheKeyCannotBeRenamed() throws Exception {
        // given
        Person jane = people.save(new Person("Jane", "Doe", "jane.doe@example.org"));
        UserAccount holder = new UserAccount(jane, "doe.jane", passwords.encode("correct-horse"), Set.of(Role.MEMBER), "en");
        holder.enable();
        accounts.save(holder);
        Testcontainers.exposeHostPorts(port);
        var pin = Pattern.compile("caddy(?::[\\w.-]+)?@sha256:[a-f0-9]{64}")
                .matcher(Files.readString(Path.of("deploy/compose.caddy.yaml")));
        assertThat(pin.find()).isTrue();
        String configuration = Files.readString(Path.of("deploy/Caddyfile.dev"))
                .replace("host.docker.internal:8080", "host.testcontainers.internal:" + port);
        try (var proxy = new GenericContainer<>(pin.group()).withExposedPorts(8080)
                .withCopyToContainer(Transferable.of(configuration), "/etc/caddy/Caddyfile")) {
            proxy.start();
            base = URI.create("http://" + proxy.getHost() + ":" + proxy.getMappedPort(8080));
            var authenticator = enrollAndSignIn();
            String route = "/api/account/mfa/webauthn/credentials/" + authenticator.credentialId().toBase64UrlString();

            // when
            var refused = send("QUERY", route, "{\"label\":\"Unexpected rename\"}", "application/json");

            // then
            assertThat(credentials.findByCredentialId(authenticator.credentialId()).getLabel())
                    .isEqualTo("Private security key");
            assertThat(refused.statusCode()).as(refused.body()).isEqualTo(405);
            assertThat(refused.body()).contains("urn:courtside:error:method-not-supported");
            var accepted = send("PATCH", route, "{\"label\":\"Intended rename\"}", "application/json");
            assertThat(accepted.statusCode()).as(accepted.body()).isEqualTo(204);
            assertThat(credentials.findByCredentialId(authenticator.credentialId()).getLabel())
                    .isEqualTo("Intended rename");
        }
    }

    private WebAuthnAuthenticatorFixture enrollAndSignIn() throws Exception {
        signIn(200);
        var registration = send("POST", "/api/account/mfa/webauthn/registration-options", "", "application/json");
        assertThat(registration.statusCode()).as(registration.body()).isEqualTo(200);
        var authenticator = new WebAuthnAuthenticatorFixture();
        var options = codec.decode(registration.body(), PublicKeyCredentialCreationOptions.class);
        var enrolled = send("POST", "/api/account/mfa/webauthn", "{\"label\":\"Private security key\",\"credential\":"
                + codec.encode(authenticator.register(options, ORIGIN)) + "}", "application/json");
        assertThat(enrolled.statusCode()).isEqualTo(200);
        signIn(202);
        var challenge = send("POST", "/api/session/mfa/webauthn/options", "", "application/json");
        assertThat(challenge.statusCode()).as(challenge.body()).isEqualTo(200);
        var request = codec.decode(challenge.body(), PublicKeyCredentialRequestOptions.class);
        var proven = send("POST", "/api/session/mfa/webauthn",
                codec.encode(authenticator.assertion(request, ORIGIN)), "application/json");
        assertThat(proven.statusCode()).as(proven.body()).isEqualTo(200);
        var session = send("GET", "/api/session", "", "application/json");
        assertThat(session.body()).contains("\"authenticated\":true");
        return authenticator;
    }

    private void signIn(int expected) throws Exception {
        assertThat(send("GET", "/api/session", "", "application/json").statusCode()).isEqualTo(200);
        var response = send("POST", "/api/session", "username=doe.jane&password=correct-horse",
                "application/x-www-form-urlencoded");
        assertThat(response.statusCode()).as(response.body()).isEqualTo(expected);
        assertThat(send("GET", "/api/session", "", "application/json").statusCode()).isEqualTo(200);
    }

    private HttpResponse<String> send(String method, String route, String body, String contentType) throws Exception {
        String token = cookies.getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                .map(java.net.HttpCookie::getValue).findFirst().orElse("");
        return client.send(HttpRequest.newBuilder(base.resolve(route))
                .header("Content-Type", contentType).header("X-XSRF-TOKEN", token)
                .method(method, HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
}
