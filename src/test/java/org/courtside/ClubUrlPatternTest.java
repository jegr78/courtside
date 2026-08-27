package org.courtside;

import jakarta.validation.constraints.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;

import static org.assertj.core.api.Assertions.assertThat;

class ClubUrlPatternTest {

    @Test
    void whenReadingEveryClubUrlPatternCopy_thenTheyAllAgreeWithTheImprintCheck()
            throws IOException, ReflectiveOperationException {
        // given
        String canonical = sqlCheckRegex("V9__club_config.sql", "imprint_url");
        // The logo differs in exactly one way: it refuses plain HTTP, because a subresource loaded
        // over it would downgrade a page the club serves over TLS.
        String logo = canonical.replace("https?", "https");

        // when / then
        assertThat(sqlCheckRegex("V40__club_config_privacy_url.sql", "privacy_url"))
                .as("club_config_privacy_url_safe has drifted from club_config_imprint_url_safe")
                .isEqualTo(canonical);
        assertThat(sqlCheckRegex("V9__club_config.sql", "logo_url"))
                .as("club_config_logo_url_safe differs from the link checks by more than the scheme")
                .isEqualTo(logo);
        for (String model : new String[]{"ApiClubConfig", "ApiClubConfigRequest"}) {
            assertThat(accessorPattern(model, "getImprintUrl"))
                    .as("%s.imprintUrl's pattern has drifted from club_config_imprint_url_safe", model)
                    .isEqualTo(canonical);
            assertThat(accessorPattern(model, "getPrivacyUrl"))
                    .as("%s.privacyUrl's pattern has drifted from club_config_imprint_url_safe", model)
                    .isEqualTo(canonical);
            assertThat(accessorPattern(model, "getLogoUrl"))
                    .as("%s.logoUrl's pattern has drifted from club_config_logo_url_safe", model)
                    .isEqualTo(logo);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"/\t/evil.example", "/\n/evil.example", "/\r/evil.example",
            "//evil.example", "/\\evil.example", "https://a.example/\tx", "javascript:alert(1)"})
    void givenATargetOffThisOrigin_whenAClubUrlIsMeasuredAgainstThePattern_thenItIsRefused(
            String candidate) throws IOException {
        // given — a browser removes tab, newline and carriage return before it parses a URL, so
        // "/<TAB>/host" reaches the same off-origin target as "//host".
        String canonical = sqlCheckRegex("V9__club_config.sql", "imprint_url");

        // when / then
        assertThat(java.util.regex.Pattern.matches(canonical, candidate))
                .as("%s must not pass for a club URL", candidate.replace("\t", "\\t"))
                .isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/", "/privacy", "/a/b?c=d#e", "http://a.example/p", "https://a.example/p"})
    void givenATargetAClubMayName_whenItIsMeasuredAgainstThePattern_thenItIsAccepted(String candidate)
            throws IOException {
        // when / then
        assertThat(java.util.regex.Pattern.matches(
                sqlCheckRegex("V9__club_config.sql", "imprint_url"), candidate)).isTrue();
    }

    private static String sqlCheckRegex(String migrationFileName, String columnName) throws IOException {
        String content = Files.readString(
                Path.of("src/main/resources/db/migration", migrationFileName));
        Matcher matcher = java.util.regex.Pattern
                .compile(java.util.regex.Pattern.quote(columnName) + " ~ '([^']+)'")
                .matcher(content);
        assertThat(matcher.find())
                .as("%s must contain a CHECK on %s ~ '...'", migrationFileName, columnName)
                .isTrue();
        return matcher.group(1);
    }

    private static String accessorPattern(String simpleName, String accessorName)
            throws ReflectiveOperationException {
        Method accessor = Class.forName("org.courtside.api." + simpleName)
                .getDeclaredMethod(accessorName);
        return accessor.getAnnotation(Pattern.class).regexp();
    }
}
