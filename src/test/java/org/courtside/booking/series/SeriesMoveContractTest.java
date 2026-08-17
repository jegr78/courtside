package org.courtside.booking.series;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SeriesMoveContractTest {

    @Test
    void givenSeriesMoveOperations_whenReadingTheApiContract_thenTheirPreservedDateSemanticsAreExplicit()
            throws IOException {
        // given
        Map<String, Object> document = apiDocument();
        Map<String, Object> schemas = value(value(document, "components"), "schemas");
        Map<String, Object> paths = value(document, "paths");

        // when
        String requestDescription = value(value(schemas, "MoveRequest"), "description");
        String previewDescription = operationDescription(paths, "/api/booking-series/{id}/move/preview");
        String moveDescription = operationDescription(paths, "/api/booking-series/{id}/move");
        String previewResponseDescription = successDescription(paths, "/api/booking-series/{id}/move/preview");
        String moveResponseDescription = successDescription(paths, "/api/booking-series/{id}/move");

        // then
        assertThat(requestDescription)
                .contains("original local date", "time of day", "duration", "courts")
                .containsIgnoringCase("not a date-shift operation");
        assertThat(previewDescription).contains("original local date");
        assertThat(moveDescription).contains("original local date");
        assertThat(previewResponseDescription).contains("original local date");
        assertThat(moveResponseDescription).contains("original local date");
    }

    private static String operationDescription(Map<String, Object> paths, String path) {
        Map<String, Object> operation = value(value(paths, path), "post");
        return value(operation, "description");
    }

    private static String successDescription(Map<String, Object> paths, String path) {
        Map<String, Object> operation = value(value(paths, path), "post");
        Map<String, Object> responses = value(operation, "responses");
        return value(value(responses, "200"), "description");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> apiDocument() throws IOException {
        try (InputStream input = SeriesMoveContractTest.class.getResourceAsStream("/api/openapi.yaml")) {
            assertThat(input).isNotNull();
            return new Yaml().load(input);
        }
    }

    @SuppressWarnings("unchecked")
    private static <T> T value(Map<String, ?> source, String key) {
        return (T) source.get(key);
    }
}
