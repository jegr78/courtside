package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class AuthenticationPathwaySurfaceTest {

    private static final List<String> OTHER_PATHWAYS = List.of(
            "oauth2Login", "oauth2Client", "oauth2ResourceServer", "saml2Login", "openidLogin",
            "httpBasic", "rememberMe", "x509(", "jee(", "preAuthentication");

    @Test
    void whenReadingTheSecurityConfiguration_thenOneAuthenticationPathwayIsConfigured() throws IOException {
        // given
        String configuration = Files.readString(
                Path.of("src/main/java/org/courtside/identity/internal/SecurityConfiguration.java"));

        // when
        TreeSet<String> configured = new TreeSet<>(OTHER_PATHWAYS.stream()
                .filter(configuration::contains).toList());

        // then
        assertThat(configuration).contains(".formLogin(");
        assertThat(configured)
                .as("a second way in is a second set of controls to keep consistent, and ASVS asks"
                        + " for every pathway to be documented with the strength it enforces."
                        + " Document it in docs/design.md and give the controls under"
                        + " MAN-IDENTITY-001 their own evidence before adding one.")
                .isEmpty();
    }

    @Test
    void whenReadingTheShippedSource_thenNoIdentityProviderIntegrationIsThere() throws IOException {
        // given
        List<String> federation = List.of("OidcUser", "OAuth2AuthenticationToken", "ClientRegistration",
                "Saml2Authentication", "JwtDecoder", "OpenSaml");
        TreeSet<String> integrating = new TreeSet<>();

        // when
        try (Stream<Path> sources = Files.walk(Path.of("src/main/java"))) {
            for (Path source : sources.filter(path -> path.toString().endsWith(".java")).toList()) {
                String text = Files.readString(source);
                if (federation.stream().anyMatch(text::contains)) {
                    integrating.add(Path.of("src/main/java").relativize(source).toString());
                }
            }
        }

        // then
        assertThat(integrating)
                .as("an external identity provider makes the OAuth, OIDC and assertion controls apply"
                        + " to Courtside, and each of them then needs its own evidence.")
                .isEmpty();
    }
}
