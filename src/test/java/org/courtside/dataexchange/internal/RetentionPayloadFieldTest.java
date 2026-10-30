package org.courtside.dataexchange.internal;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class RetentionPayloadFieldTest {

    private static final Set<String> BOOKING_REFERENCES = Set.of("bookingId", "bookingIds", "seriesId");
    private static final Set<String> NAMES_NOBODY = Set.of("reason", "closure", "outcome", "grantId",
            "previousStartsAt", "previousEndsAt", "previousCourtIds", "accessPointIds");

    @Test
    void givenEveryEventThatNamesABookingOrSeries_whenItsFieldsAreRead_thenEachFieldNamingSomebodyIsOneTheRunStrips()
            throws IOException {
        // given
        Pattern personal = Pattern.compile(RetentionRows.PERSONAL_PAYLOAD_FIELD, Pattern.CASE_INSENSITIVE);
        Map<String, List<String>> bookingEvents = payloadFields().entrySet().stream()
                .filter(entry -> entry.getValue().stream().anyMatch(BOOKING_REFERENCES::contains))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        // when
        List<String> unclassified = bookingEvents.entrySet().stream()
                .flatMap(entry -> entry.getValue().stream()
                        .filter(field -> !BOOKING_REFERENCES.contains(field) && !NAMES_NOBODY.contains(field))
                        .filter(field -> !personal.matcher(field).find())
                        .map(field -> entry.getKey() + "." + field))
                .toList();
        List<String> stripped = bookingEvents.values().stream().flatMap(List::stream)
                .filter(field -> personal.matcher(field).find()).distinct().toList();

        // then
        assertThat(bookingEvents).as("the payload inventory must be read whole").isNotEmpty();
        assertThat(unclassified)
                .as("a booking event field that may name a person must match what a retention run strips, "
                        + "or be listed as naming nobody")
                .isEmpty();
        assertThat(stripped).as("the run strips the person and account fields the inventory declares")
                .contains("personId", "accountId", "cancelledByAccountId", "movedByAccountId");
    }

    private static Map<String, List<String>> payloadFields() throws IOException {
        Properties properties = new Properties();
        try (InputStream source = RetentionPayloadFieldTest.class.getClassLoader()
                .getResourceAsStream("domain-event-payload.properties")) {
            assertThat(source).as("the domain event payload inventory is on the test classpath").isNotNull();
            properties.load(source);
        }
        return properties.stringPropertyNames().stream().collect(Collectors.toMap(name -> name,
                name -> Arrays.stream(properties.getProperty(name).split(",")).map(String::trim)
                        .filter(field -> !field.isEmpty()).toList()));
    }
}
