package org.courtside.shared;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.net.URI;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProblemTypeTest {

    private static ProblemType withSlug(String slug) {
        return new ProblemType(slug, HttpStatus.NOT_FOUND, "Court not found", "No such court");
    }

    @Test
    void givenASlug_whenAskedForItsUri_thenItIsTheCourtsideErrorUrn() {
        // when / then
        assertThat(withSlug("court-not-found").uri())
                .isEqualTo(URI.create("urn:courtside:error:court-not-found"));
    }

    @Test
    void whenTheSlugIsNotKebabCase_thenItIsRejected() {
        // given — the URN scheme is a published contract; ProblemTypeUriTest reads these
        // constants, so a slug that does not fit the scheme must not compile into one
        // when / then
        assertThatThrownBy(() -> withSlug("Court_Not_Found"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Court_Not_Found");
    }

    @Test
    void whenTheSlugAlreadyCarriesTheUrnPrefix_thenItIsRejected() {
        // given — the prefix is added by uri(); carrying it here would double it
        // when / then
        assertThatThrownBy(() -> withSlug("urn:courtside:error:court-not-found"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenTheSlugIsBlank_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> withSlug(" ")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenTheSlugIsMissing_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> withSlug(null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenTheStatusIsMissing_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new ProblemType("court-not-found", null, "Title", "Detail"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenTheStatusIsNotAnError_thenItIsRejected() {
        // given — a problem detail describes a failure; a 2xx here would ship a success status
        // on a response body that says something went wrong
        // when / then
        assertThatThrownBy(() -> new ProblemType("court-not-found", HttpStatus.OK, "Title", "Detail"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenTheTitleIsBlank_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new ProblemType("court-not-found", HttpStatus.NOT_FOUND, " ", "Detail"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void whenTheDetailIsBlank_thenItIsRejected() {
        // when / then
        assertThatThrownBy(() -> new ProblemType("court-not-found", HttpStatus.NOT_FOUND, "Title", " "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
