package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import org.springframework.boot.info.BuildProperties;

import java.net.URI;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SourceOfferUrlTest {

    @Test
    void givenAnAddressNoMemberCouldOpen_whenStarting_thenTheInstanceRefusesToStart() {
        // given — the value comes from an environment variable, and java.net.URI checks syntax
        // rather than scheme: every one of these parses, and none of them is an offer of source
        for (String notAnOffer : new String[] {
                "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd",
                "//evil.example/x", "", "ftp://example.org/courtside"}) {

            // when / then
            assertThatThrownBy(() -> controllerWith(notAnOffer))
                    .as("%s", notAnOffer)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("courtside.source-url");
        }
    }

    @Test
    void givenAnAddressAMemberCanOpen_whenStarting_thenItIsAccepted() {
        // when / then
        assertThatCode(() -> controllerWith("https://example.org/git/courtside"))
                .doesNotThrowAnyException();
        assertThatCode(() -> controllerWith("http://example.org/git/courtside"))
                .doesNotThrowAnyException();
    }

    private static SourceOfferController controllerWith(String sourceUrl) {
        Properties build = new Properties();
        build.setProperty("version", "0.1.0");
        return new SourceOfferController(new BuildProperties(build), null, URI.create(sourceUrl));
    }
}
