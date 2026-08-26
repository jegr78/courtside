package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ReferenceDeploymentSecurityTest {

    private static final Pattern REVERSE_PROXY_BLOCK = Pattern.compile(
            "(?m)^\\treverse_proxy app:8080 \\{\\R(?<directives>(?:\\t\\t[^\\r\\n]*\\R)*)\\t}$");
    private static final Pattern PRODUCTION_SITE_BLOCK = Pattern.compile(
            "(?m)^\\{\\$COURTSIDE_DOMAIN} \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern UAT_PUBLIC_SITE_BLOCK = Pattern.compile(
            "(?m)^https://localhost:443 \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern HEADER_BLOCK = Pattern.compile(
            "(?m)^\\theader \\{\\R(?<fields>(?:\\t\\t.*\\R)*)\\t}$");

    private static final String GHCR_RELEASE_IMAGE =
            "image: ghcr.io/jegr78/courtside:${COURTSIDE_VERSION:?set COURTSIDE_VERSION in .env}";
    private static final String UAT_LOCAL_IMAGE_ALIAS =
            "image: ${COURTSIDE_UAT_IMAGE:-courtside:uat-local}";
    private static final String PERF_LOCAL_IMAGE_ALIAS =
            "image: courtside:perf-local";
    private static final String UPGRADE_CANDIDATE_IMAGE_ALIAS =
            "image: ${COURTSIDE_UPGRADE_IMAGE}";
    private static final String RESTORE_CANDIDATE_IMAGE_ALIAS =
            "image: ${COURTSIDE_RESTORE_IMAGE}";
    private static final String SECURITY_CANDIDATE_IMAGE_ALIAS =
            "image: ${COURTSIDE_SECURITY_IMAGE:?required}";
    private static final Set<String> OWN_IMAGE_REFERENCES =
            Set.of(GHCR_RELEASE_IMAGE, UAT_LOCAL_IMAGE_ALIAS, PERF_LOCAL_IMAGE_ALIAS,
                    UPGRADE_CANDIDATE_IMAGE_ALIAS, RESTORE_CANDIDATE_IMAGE_ALIAS,
                    SECURITY_CANDIDATE_IMAGE_ALIAS);

    @Test
    void whenReadingImageSources_thenEveryThirdPartyImageIsPinnedByDigest() throws IOException {
        // given
        List<Path> sources;
        try (var deploymentFiles = Files.list(Path.of("deploy"))) {
            sources = deploymentFiles
                    .filter(path -> path.getFileName().toString().matches("compose(?:\\..+)?\\.yaml"))
                    .sorted()
                    .toList();
        }

        // when / then
        for (Path source : Stream.concat(Stream.of(Path.of("Dockerfile")), sources.stream()).toList()) {
            Files.readAllLines(source).stream()
                    .map(String::strip)
                    .filter(line -> line.startsWith("FROM ") || line.startsWith("image:"))
                    .filter(line -> !OWN_IMAGE_REFERENCES.contains(line))
                    .forEach(line -> assertThat(line)
                            .as("%s pins its image by digest", source)
                            .contains("@sha256:"));
        }
    }

    @Test
    void whenReadingProductionCompose_thenOwnImageIsSelectedByVersionNotDigest() throws IOException {
        // given
        List<String> ownImageLines = Files.readAllLines(Path.of("deploy/compose.yaml")).stream()
                .map(String::strip)
                .filter(OWN_IMAGE_REFERENCES::contains)
                .toList();

        // when / then
        assertThat(ownImageLines).containsExactly(GHCR_RELEASE_IMAGE);
    }

    @Test
    void whenReadingTheContainerEntrypoint_thenUnsupportedUnsafeAccessIsDenied() throws IOException {
        // when
        String dockerfile = Files.readString(Path.of("Dockerfile"));

        // then
        assertThat(dockerfile)
                .contains("--sun-misc-unsafe-memory-access=deny")
                .doesNotContain("--sun-misc-unsafe-memory-access=allow");
    }

    @Test
    void whenReadingComposeFile_thenApplicationPortIsBoundToLoopback() throws IOException {
        // when
        String compose = Files.readString(Path.of("deploy/compose.yaml"));

        // then
        assertThat(compose).contains("127.0.0.1:${COURTSIDE_PORT:-8080}:8080");
    }

    // An instance without mail configuration refuses to start, so a world that runs the image and
    // forgets it is a world that will not come up — in a workflow that may only run weekly.
    @Test
    void whenAComposeFileRunsTheApplication_thenItConfiguresTheMailItCannotStartWithout()
            throws IOException {
        // given
        List<Path> sources;
        try (var deploymentFiles = Files.list(Path.of("deploy"))) {
            sources = deploymentFiles
                    .filter(path -> path.getFileName().toString().matches("compose(?:\\..+)?\\.yaml"))
                    .sorted()
                    .toList();
        }

        // when / then
        for (Path source : sources) {
            String compose = Files.readString(source);
            if (OWN_IMAGE_REFERENCES.stream().noneMatch(compose::contains)) {
                continue;
            }
            assertThat(compose)
                    .as("%s runs the application", source)
                    .contains("COURTSIDE_MAIL_RELAY_HOST")
                    .contains("COURTSIDE_MAIL_FROM")
                    .contains("COURTSIDE_MAIL_REPLY_TO");
        }
    }

    @Test
    void whenReadingCaddyfile_thenForwardedHeadersAreReplacedAtTrustBoundary() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));
        Matcher reverseProxy = REVERSE_PROXY_BLOCK.matcher(caddyfile);

        // then
        assertThat(reverseProxy.find()).isTrue();
        assertThat(reverseProxy.group("directives").lines().map(String::strip).toList()).containsExactly(
                "header_up -Forwarded",
                "header_up -X-Forwarded-For",
                "header_up -X-Forwarded-Host",
                "header_up -X-Forwarded-Port",
                "header_up -X-Forwarded-Prefix",
                "header_up -X-Forwarded-Proto",
                "header_up -X-Forwarded-Ssl",
                "header_up X-Forwarded-For {remote_host}",
                "header_up X-Forwarded-Host {host}",
                "header_up X-Forwarded-Proto {scheme}");
    }

    @Test
    void whenReadingSecurityCaddyfile_thenProductionProxyTrustBoundaryIsPreserved() throws IOException {
        // given
        String production = Files.readString(Path.of("deploy/Caddyfile"));
        String security = Files.readString(Path.of("deploy/Caddyfile.security"));
        Matcher productionProxy = REVERSE_PROXY_BLOCK.matcher(production);
        Matcher securityProxy = REVERSE_PROXY_BLOCK.matcher(security);

        // when / then
        assertThat(productionProxy.find()).isTrue();
        assertThat(securityProxy.find()).isTrue();
        assertThat(securityProxy.group("directives").lines().map(String::strip).toList())
                .containsExactly("header_up Host localhost",
                        "header_up -Forwarded",
                        "header_up -X-Forwarded-For",
                        "header_up -X-Forwarded-Host",
                        "header_up -X-Forwarded-Port",
                        "header_up -X-Forwarded-Prefix",
                        "header_up -X-Forwarded-Proto",
                        "header_up -X-Forwarded-Ssl",
                        "header_up Forwarded \"for={remote_host};host=localhost;proto={scheme}\"",
                        "header_up X-Forwarded-For {remote_host}",
                        "header_up X-Forwarded-Host localhost",
                        "header_up X-Forwarded-Proto {scheme}");
        assertThat(security)
                .contains("X-Content-Type-Options nosniff", "X-Frame-Options DENY",
                        "Referrer-Policy strict-origin-when-cross-origin",
                        "Permissions-Policy \"geolocation=(), camera=(), microphone=()\"")
                .doesNotContain("Strict-Transport-Security");
    }

    @Test
    void whenReadingCaddyfile_thenRequestBodiesHaveABoundedSize() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));
        String uatCaddyfile = Files.readString(Path.of("deploy/Caddyfile.uat"));

        // then
        assertThat(caddyfile).contains("request_body {\n\t\tmax_size 2MB\n\t}");
        assertThat(uatCaddyfile.lines().filter(line -> line.strip().equals("max_size 2MB")).count())
                .isEqualTo(2);
    }

    @Test
    void givenTheApiHasNoPatchOperation_whenReadingProxiedDeployments_thenUnknownMethodsReachSpringAsPatch()
            throws IOException {
        // given
        String api = Files.readString(Path.of("src/main/resources/api/openapi.yaml"));

        // when / then
        assertThat(api).doesNotContain("    patch:");
        for (String name : List.of(
                "Caddyfile", "Caddyfile.dev", "Caddyfile.perf", "Caddyfile.security", "Caddyfile.uat")) {
            assertThat(Files.readString(Path.of("deploy", name)))
                    .as(name)
                    .contains("@unknownMethod {", "method QUERY", "path /api/*", "method @unknownMethod PATCH");
        }
    }

    @Test
    void whenReadingCaddyfile_thenTheApplicationContentSecurityPolicyIsNotReplaced() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));

        // then
        assertThat(caddyfile).doesNotContain("Content-Security-Policy");
    }

    @Test
    void whenReadingEveryCaddyfile_thenProxyImplementationDisclosureIsRemoved() throws IOException {
        // given
        List<Path> caddyfiles;
        try (var deploymentFiles = Files.list(Path.of("deploy"))) {
            caddyfiles = deploymentFiles
                    .filter(path -> path.getFileName().toString().startsWith("Caddyfile"))
                    .sorted()
                    .toList();
        }

        // when / then
        for (Path caddyfile : caddyfiles) {
            assertThat(Files.readString(caddyfile))
                    .as("%s removes proxy implementation disclosure", caddyfile)
                    .contains("-Via");
        }
    }

    @Test
    void whenReadingEveryCaddyfile_thenTheSecurityHeadersAgree() throws IOException {
        // when
        String production = Files.readString(Path.of("deploy/Caddyfile"));
        String uat = Files.readString(Path.of("deploy/Caddyfile.uat"));
        List<String> productionHeaders = headerDirectives(production, PRODUCTION_SITE_BLOCK);
        List<String> uatHeaders = headerDirectives(uat, UAT_PUBLIC_SITE_BLOCK);
        List<String> expectedUatHeaders = productionHeaders.stream()
                .filter(directive -> !fieldName(directive).equals("Strict-Transport-Security"))
                .toList();

        // then
        assertThat(uatHeaders)
                .as("Caddyfile.uat's public https://localhost block omits Strict-Transport-Security "
                        + "because HSTS is host- not port-scoped: setting it there would force every "
                        + "other localhost port in the same browser into HTTPS for the max-age duration")
                .containsExactlyInAnyOrderElementsOf(expectedUatHeaders);
    }

    private static List<String> headerDirectives(String caddyfile, Pattern siteBlock) {
        Matcher site = siteBlock.matcher(caddyfile);
        assertThat(site.find()).isTrue();
        Matcher header = HEADER_BLOCK.matcher(site.group("body"));
        assertThat(header.find()).isTrue();
        return header.group("fields").lines()
                .map(String::strip)
                .toList();
    }

    private static String fieldName(String directive) {
        String token = directive.split("\\s+", 2)[0];
        return token.startsWith("-") ? token.substring(1) : token;
    }
}
