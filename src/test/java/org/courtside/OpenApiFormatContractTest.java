package org.courtside;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.InputStream;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.courtside.api.ApiProblem;
import org.courtside.api.ApiOpeningHours;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

class OpenApiFormatContractTest {

    private final Map<String, Object> document = loadDocument();

    @Test
    void givenProblemInstances_whenCheckingTheirContract_thenUriReferencesAreAcceptedPrecisely() {
        // given
        Map<String, Object> instance = property("Problem", "instance");

        // when / then
        assertThat(instance).containsEntry("type", "string").containsEntry("format", "uri-reference");
        assertThat(List.of("/api/bookings/123", "urn:courtside:request:123", "?cursor=next"))
                .allSatisfy(value -> assertThat(URI.create(value)).isNotNull());
        assertThatThrownBy(() -> URI.create("/api/bookings/invalid value"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> URI.create("/api/bookings/%invalid"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void givenClubLocalTimes_whenCheckingTheirContract_thenOffsetsAndInvalidClockValuesAreRejected() {
        // given
        Map<String, Object> localTime = schema("LocalTime");
        Map<String, Object> nullableLocalTime = schema("NullableLocalTime");
        Pattern pattern = Pattern.compile((String) localTime.get("pattern"));

        // when / then
        assertThat(localTime).containsEntry("type", "string").containsEntry("format", "local-time");
        assertThat(nullableLocalTime)
                .containsEntry("type", List.of("string", "null"))
                .containsEntry("format", "local-time")
                .containsEntry("pattern", localTime.get("pattern"));
        assertThat(List.of("00:00", "08:15", "23:59:59", "12:30:45.123456789"))
                .allSatisfy(value -> assertThat(pattern.matcher(value).matches()).isTrue());
        assertThat(List.of("8:15", "24:00", "12:60", "12:30Z", "12:30:00+02:00", "12:30:00."))
                .allSatisfy(value -> assertThat(pattern.matcher(value).matches()).isFalse());
    }

    @Test
    void givenWallClockFields_whenCheckingTheirSchemas_thenTheyShareTheLocalTimeContract() {
        // when / then
        assertThat(property("OpeningHours", "opensAt")).containsEntry("$ref", "#/components/schemas/NullableLocalTime");
        assertThat(property("OpeningHours", "closesAt")).containsEntry("$ref", "#/components/schemas/NullableLocalTime");
        assertThat(property("SetWeeklyOpeningHoursRequest", "days"))
                .containsEntry("items", Map.of("$ref", "#/components/schemas/OpeningHours"));
        assertThat(property("SeriesRuleRequest", "startTime")).containsEntry("$ref", "#/components/schemas/LocalTime");
        assertThat(property("MoveRequest", "newStartTime")).containsEntry("$ref", "#/components/schemas/NullableLocalTime");
        assertThat(parameter("/api/admin/impact/opening-hours/{day}", "opensAt"))
                .containsEntry("$ref", "#/components/schemas/LocalTime");
        assertThat(parameter("/api/admin/impact/opening-hours/{day}", "closesAt"))
                .containsEntry("$ref", "#/components/schemas/LocalTime");
    }

    @Test
    void givenMappedLocalTimes_whenGeneratingBeanValidation_thenOnlyCompatibleAnnotationsRemain()
            throws NoSuchMethodException {
        // when
        boolean localTimeHasPattern = ApiOpeningHours.class.getMethod("getOpensAt")
                .isAnnotationPresent(jakarta.validation.constraints.Pattern.class);
        boolean stringHasPattern = ApiProblem.class.getMethod("getTraceId")
                .isAnnotationPresent(jakarta.validation.constraints.Pattern.class);

        // then
        assertThat(localTimeHasPattern).isFalse();
        assertThat(stringHasPattern).isTrue();
    }

    @Test
    void givenBookingCardRoles_whenReadingTheirContract_thenBothEmptyCasesAreActionable() {
        // when / then
        List.of("BookingCard", "BookingCardRequest").forEach(schema -> {
            assertThat(normalizedDescription(schema, "allowedRoles"))
                    .as("%s.allowedRoles", schema)
                    .contains("Holding any listed role is sufficient")
                    .contains("Empty permits every authenticated member account")
                    .contains("Future external accounts require `EXTERNAL_BOOKER` explicitly")
                    .contains("Administrators may always book");
            assertThat(normalizedDescription(schema, "managingRoles").toLowerCase())
                    .as("%s.managingRoles", schema)
                    .contains("empty means only an admin may");
        });
    }

    private String normalizedDescription(String schema, String property) {
        Object description = property(schema, property).get("description");
        return description == null ? null : description.toString().replaceAll("\\s+", " ").trim();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parameter(String path, String name) {
        Map<String, Object> paths = (Map<String, Object>) document.get("paths");
        Object pathItem = paths.get(path);
        if (!(pathItem instanceof Map<?, ?> pathMap) || !(pathMap.get("get") instanceof Map<?, ?> operation)) {
            throw new IllegalStateException("OpenAPI operation is missing: GET " + path);
        }
        return ((List<Map<String, Object>>) operation.get("parameters")).stream()
                .filter(parameter -> name.equals(parameter.get("name")))
                .map(parameter -> (Map<String, Object>) parameter.get("schema"))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("OpenAPI parameter is missing: " + name));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> property(String schema, String property) {
        return (Map<String, Object>) ((Map<String, Object>) schema(schema).get("properties")).get(property);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> schema(String name) {
        Map<String, Object> components = (Map<String, Object>) document.get("components");
        return (Map<String, Object>) ((Map<String, Object>) components.get("schemas")).get(name);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> loadDocument() {
        try (InputStream input = OpenApiFormatContractTest.class.getResourceAsStream("/api/openapi.yaml")) {
            if (input == null) {
                throw new IllegalStateException("OpenAPI document is missing");
            }
            return new Yaml().load(input);
        } catch (Exception failure) {
            throw new IllegalStateException("Could not read the OpenAPI document", failure);
        }
    }
}
