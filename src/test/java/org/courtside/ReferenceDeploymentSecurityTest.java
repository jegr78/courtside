package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class ReferenceDeploymentSecurityTest {

    private static final Pattern REVERSE_PROXY_BLOCK = Pattern.compile(
            "(?m)^\\treverse_proxy app:8080 \\{\\R(?<directives>(?:\\t\\t[^\\r\\n]*\\R)*)\\t}$");
    private static final Pattern UPSTREAM = Pattern.compile("(?m)^\\t*reverse_proxy [^\\r\\n]*\\{");
    private static final Pattern APPLICATION_HEADERS = Pattern.compile(
            "(?m)^\\(applicationHeaders\\) \\{\\R(?<directives>(?:\\t[^\\r\\n]*\\R)*)}$");
    private static final Pattern PRODUCTION_SITE_BLOCK = Pattern.compile(
            "(?m)^\\{\\$COURTSIDE_DOMAIN} \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern UAT_PUBLIC_SITE_BLOCK = Pattern.compile(
            "(?m)^https://localhost:443 \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern PRODUCTION_PLAINTEXT_SITE_BLOCK = Pattern.compile(
            "(?m)^http://:80 \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern UAT_PLAINTEXT_SITE_BLOCK = Pattern.compile(
            "(?m)^http://:80 \\{\\R(?<body>(?:.*\\R)*?)^}$");
    private static final Pattern HEADER_BLOCK = Pattern.compile(
            "(?m)^\\theader \\{\\R(?<fields>(?:\\t\\t.*\\R)*)\\t}$");
    private static final Pattern SERVICE_BLOCK = Pattern.compile(
            "(?ms)^  [a-zA-Z0-9_-]+:\\R(?<body>.*?)(?=^  [a-zA-Z0-9_-]+:\\R|\\z)");

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
            if (serviceBodies(compose).stream().noneMatch(ReferenceDeploymentSecurityTest::runsApplication)) {
                continue;
            }
            assertThat(compose)
                    .as("%s runs the application", source)
                    .contains("COURTSIDE_MAIL_RELAY_HOST")
                    .contains("COURTSIDE_MAIL_FROM")
                    .contains("COURTSIDE_MAIL_REPLY_TO");
        }
    }

    private static boolean runsApplication(String service) {
        return OWN_IMAGE_REFERENCES.stream().anyMatch(service::contains)
                && !service.contains("command: [\"--courtside-database-");
    }

    private static List<String> serviceBodies(String compose) {
        return SERVICE_BLOCK.matcher(compose).results()
                .map(match -> match.group("body"))
                .toList();
    }

    @Test
    void whenReadingCaddyfile_thenForwardedHeadersAreReplacedAtEveryUpstream() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));
        Matcher headers = APPLICATION_HEADERS.matcher(caddyfile);

        // then
        assertThat(headers.find()).isTrue();
        assertThat(upstreamBodies(caddyfile)).isNotEmpty().allSatisfy(body -> {
            assertThat(body.lines().map(String::strip)
                    .filter("import applicationHeaders"::equals).count()).isEqualTo(1);
            assertThat(body.lines().map(String::strip))
                    .noneMatch(directive -> directive.startsWith("header_up"));
        });
        assertThat(headers.group("directives").lines().map(String::strip).toList()).containsExactly(
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

    // An upstream that imported the snippet and then added a header_up of its own would put the
    // client's value back, and an equal number of imports and upstreams would not notice.
    private static List<String> upstreamBodies(String caddyfile) {
        List<String> bodies = new ArrayList<>();
        Matcher upstream = UPSTREAM.matcher(caddyfile);
        while (upstream.find()) {
            int depth = 0;
            for (int cursor = upstream.end() - 1; cursor < caddyfile.length(); cursor++) {
                char character = caddyfile.charAt(cursor);
                depth += character == '{' ? 1 : character == '}' ? -1 : 0;
                if (depth == 0) {
                    bodies.add(caddyfile.substring(upstream.end(), cursor));
                    break;
                }
            }
        }
        return bodies;
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
        assertThat(caddyfile)
                .contains("+Content-Security-Policy \"base-uri 'none'\"")
                .doesNotContain("Content-Security-Policy \"default-src");
    }

    @Test
    void givenProductionTraffic_whenReadingEdgeHeaders_thenBrowserPoliciesAreGlobalAndExact()
            throws IOException {
        // given
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));

        // when
        List<String> headers = headerDirectives(caddyfile, PRODUCTION_SITE_BLOCK);

        // then
        assertThat(headers).contains(
                "Strict-Transport-Security \"max-age=31536000; includeSubDomains\"",
                "X-Content-Type-Options nosniff",
                "Referrer-Policy strict-origin-when-cross-origin");
    }

    @Test
    void whenReadingPublicPlaintextListeners_thenOnlyKnownSafeNavigationsRedirect() throws IOException {
        // given
        String production = Files.readString(Path.of("deploy/Caddyfile"));
        String uat = Files.readString(Path.of("deploy/Caddyfile.uat"));

        // when / then
        for (var source : List.of(
                new PlaintextSource(production, PRODUCTION_PLAINTEXT_SITE_BLOCK,
                        "https://{$COURTSIDE_DOMAIN}{uri}"),
                new PlaintextSource(uat, UAT_PLAINTEXT_SITE_BLOCK, "https://localhost:8443{uri}"))) {
            Matcher site = source.pattern().matcher(source.caddyfile());
            assertThat(site.find()).isTrue();
            assertThat(site.group("body"))
                    .contains("method GET HEAD", "path / /courts /login", source.redirectTarget(),
                            "respond \"Plain HTTP is not accepted.\" 400",
                            "Content-Security-Policy \"base-uri 'none'\"",
                            "-Location", "-Set-Cookie", "-Server", "-Via")
                    .doesNotContain("reverse_proxy", "{host}", "header Accept", "header User-Agent",
                            "header Sec-Fetch");
            assertThat(source.caddyfile())
                    .startsWith("{\n\tauto_https disable_redirects\n}")
                    .doesNotContain("auto_https off", "auto_https disable_certs");
        }
        assertThat(production)
                .contains("@mailHostname host {$COURTSIDE_MAIL_HOSTNAME}")
                .contains("{$COURTSIDE_MAIL_HOSTNAME} {");
    }

    @Test
    void givenTheProductionHostname_whenReadingCaddyfile_thenPublicCertificateAutomationRemainsEnabled()
            throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));

        // then
        assertThat(caddyfile)
                .contains("{$COURTSIDE_DOMAIN} {")
                .doesNotContain("tls internal", "tls self_signed", "issuer internal", "local_certs",
                        "auto_https off", "auto_https disable_certs");
    }

    private record PlaintextSource(String caddyfile, Pattern pattern, String redirectTarget) {
    }

    @Test
    void whenReadingSecurityHeaderDocumentation_thenApplicationAndProxyResponsibilitiesStayDistinct()
            throws IOException {
        // given
        String deploymentGuide = normalized(Files.readString(Path.of("deploy/README.md")));
        String design = normalized(Files.readString(Path.of("docs/design.md")));

        // when / then
        for (String document : List.of(deploymentGuide, design)) {
            assertThat(document)
                    .contains("application sets `Content-Security-Policy`, "
                            + "`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and "
                            + "`Referrer-Policy: strict-origin-when-cross-origin` on its own responses")
                    .contains("Spring Security also sets `Strict-Transport-Security`")
                    .contains("Caddy repeats nosniff, frame denial and the referrer policy at the edge")
                    .contains("`Permissions-Policy` is the only response policy here that comes only from Caddy");
        }
        assertThat(deploymentGuide)
                .contains("Funnel keeps the application's headers")
                .contains("keeps those five application headers when Funnel supplies the trusted HTTPS "
                        + "forwarding signal")
                .contains("loses only Caddy's `Permissions-Policy` response header")
                .doesNotContain("Without the proxy there is no HSTS");
    }

    private static String normalized(String document) {
        return document.replaceAll("\\s+", " ").strip();
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
