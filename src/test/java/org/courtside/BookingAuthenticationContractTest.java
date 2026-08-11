package org.courtside;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class BookingAuthenticationContractTest {

    private static final Map<String, String> STATE_CHANGING_BOOKING_OPERATIONS = Map.of(
            "/api/bookings", "post",
            "/api/bookings/{id}", "delete",
            "/api/booking-series", "post",
            "/api/booking-series/{id}", "delete",
            "/api/booking-series/{id}/move", "post");

    private static final Set<String> ANONYMOUS_BOOKING_READS = Set.of(
            "/api/bookings",
            "/api/public/booking-grid",
            "/api/public/config",
            "/api/public/courts",
            "/api/public/opening-hours");

    @Test
    void givenBookingWrites_whenReadingTheApiContract_thenSessionAndCsrfAreRequired()
            throws IOException {
        // given
        Map<String, Object> document = apiDocument();

        // when
        Map<String, Map<String, Object>> paths = value(document, "paths");

        // then
        STATE_CHANGING_BOOKING_OPERATIONS.forEach((path, method) -> {
            Map<String, Object> operation = value(paths.get(path), method);
            assertThat(operation.get("security"))
                    .as("%s %s must require an authenticated session and CSRF token", method, path)
                    .isEqualTo(List.of(Map.of("sessionCookie", List.of(), "csrfToken", List.of())));
        });
    }

    @Test
    void givenThePublicCourtPlan_whenReadingTheApiContract_thenItsRequestsAreAnonymousAndReadOnly()
            throws IOException {
        // given
        Map<String, Object> document = apiDocument();

        // when
        Map<String, Map<String, Object>> paths = value(document, "paths");

        // then
        ANONYMOUS_BOOKING_READS.forEach(path -> {
            Map<String, Object> operation = value(paths.get(path), "get");
            assertThat(operation.get("security"))
                    .as("GET %s must explicitly override the authenticated default", path)
                    .isEqualTo(List.of());
        });
    }

    @Test
    void givenTheAuthenticationDecision_whenReadingTheDesign_thenSharedCardCredentialsAreAbsent()
            throws IOException {
        // given
        String design = Files.readString(Path.of("docs/design.md"));

        // when / then
        assertThat(design).doesNotContain("Card PIN", "pin_hash");
    }

    @Test
    void givenFutureExternalAccounts_whenReadingTheContracts_thenCardAccessMustBeExplicit()
            throws IOException {
        // given
        String design = Files.readString(Path.of("docs/design.md"));
        Map<String, Object> document = apiDocument();

        // when
        Map<String, Object> info = value(document, "info");

        // then
        assertThat(design).contains("`EXTERNAL_BOOKER`", "an empty card role\nlist never grants external access");
        assertThat((String) info.get("description"))
                .contains("`EXTERNAL_BOOKER`", "an empty card role list never grants external access");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> apiDocument() throws IOException {
        try (InputStream input = BookingAuthenticationContractTest.class
                .getResourceAsStream("/api/openapi.yaml")) {
            assertThat(input).isNotNull();
            return new Yaml().load(input);
        }
    }

    @SuppressWarnings("unchecked")
    private static <T> T value(Map<String, ?> source, String key) {
        return (T) source.get(key);
    }
}
