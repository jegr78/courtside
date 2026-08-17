package org.courtside.shared.web;

import org.junit.jupiter.api.Test;
import org.springframework.boot.info.BuildProperties;

import java.net.URI;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SourceOfferUrlTest {

    @Test
    void givenAnAddressNoMemberCouldOpen_whenStarting_thenTheInstanceRefusesToStart() {
        // given
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

    @Test
    void givenAnEnvironment_whenRequestingTheSourceOffer_thenItIdentifiesTheRunningEnvironment() {
        // given
        SourceOfferController controller = controllerWith("https://example.org/git/courtside", "UAT");

        // when
        var sourceOffer = controller.getSourceOffer().getBody();

        // then
        assertThat(sourceOffer).isNotNull();
        assertThat(sourceOffer.getEnvironment().getValue()).isEqualTo("UAT");
    }

    @Test
    void givenAnUnknownEnvironment_whenStarting_thenTheInstanceRefusesToStart() {
        // when / then
        assertThatThrownBy(() -> controllerWith("https://example.org/git/courtside", "STAGING"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("courtside.environment");
    }

    private static SourceOfferController controllerWith(String sourceUrl) {
        return controllerWith(sourceUrl, "PRODUCTION");
    }

    private static SourceOfferController controllerWith(String sourceUrl, String environment) {
        Properties build = new Properties();
        build.setProperty("version", "0.1.0");
        return new SourceOfferController(
                new BuildProperties(build), null, URI.create(sourceUrl), environment);
    }
}
