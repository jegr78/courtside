package org.courtside;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class ReferenceDeploymentSecurityTest {

    private static final Pattern REVERSE_PROXY_BLOCK = Pattern.compile(
            "(?ms)^\\treverse_proxy app:8080 \\{\\R(?<directives>(?:\\t\\t.*\\R)*)\\t}$");

    @Test
    void whenReadingComposeFile_thenApplicationPortIsBoundToLoopback() throws IOException {
        // when
        String compose = Files.readString(Path.of("deploy/compose.yaml"));

        // then
        assertThat(compose).contains("127.0.0.1:${COURTSIDE_PORT:-8080}:8080");
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
    void whenReadingCaddyfile_thenTheApplicationContentSecurityPolicyIsNotReplaced() throws IOException {
        // when
        String caddyfile = Files.readString(Path.of("deploy/Caddyfile"));

        // then
        assertThat(caddyfile).doesNotContain("Content-Security-Policy");
    }

    @Test
    void whenReadingEveryCaddyfile_thenTheSecurityHeadersAgree() throws IOException {
        // given
        List<String> headerFields = List.of(
                "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy");

        // when
        String production = Files.readString(Path.of("deploy/Caddyfile"));
        String uat = Files.readString(Path.of("deploy/Caddyfile.uat"));

        // then
        headerFields.forEach(field -> assertThat(production).contains(field));
        headerFields.forEach(field -> assertThat(uat).contains(field));
    }
}
