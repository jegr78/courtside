package org.courtside.audit;

import org.courtside.shared.DomainEventRecord;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.type.filter.AssignableTypeFilter;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class DomainEventPayloadTest {

    private static final String SNAPSHOT = "domain-event-payload.properties";

    @Test
    void givenAStoredEvent_whenItsRecordChanges_thenOnlyAddedFieldsLeaveOlderRowsReadable() {
        // given
        Map<String, String> recorded = snapshot();

        // when
        Map<String, String> published = publishedPayloads();

        // then
        assertThat(published).as(
                        "A stored row is read years after it was written. A field that disappears or is "
                                + "renamed makes it unreadable, so that change needs a new event type. A field "
                                + "that is added is fine and belongs in " + SNAPSHOT + ".")
                .containsExactlyInAnyOrderEntriesOf(recorded);
    }

    private static Map<String, String> publishedPayloads() {
        ClassPathScanningCandidateComponentProvider scan =
                new ClassPathScanningCandidateComponentProvider(false);
        scan.addIncludeFilter(new AssignableTypeFilter(DomainEventRecord.class));
        Map<String, String> payloads = new LinkedHashMap<>();
        scan.findCandidateComponents("org.courtside").stream()
                .map(candidate -> loadClass(candidate.getBeanClassName()))
                .filter(Class::isRecord)
                .forEach(type -> payloads.put(eventTypeOf(type), fieldsOf(type)));
        return payloads;
    }

    private static String fieldsOf(Class<?> type) {
        return Arrays.stream(type.getRecordComponents())
                .map(RecordComponent::getName)
                .collect(Collectors.joining(","));
    }

    // Read, never instantiated: a record of this project validates in its compact constructor.
    private static String eventTypeOf(Class<?> type) {
        try {
            Field declared = type.getDeclaredField("TYPE");
            declared.setAccessible(true);
            return (String) declared.get(null);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(
                    type.getName() + " must declare its event type as a TYPE constant", e);
        }
    }

    private static Class<?> loadClass(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("Cannot load " + name, e);
        }
    }

    private static Map<String, String> snapshot() {
        Properties properties = new Properties();
        try (InputStream source = new ClassPathResource(SNAPSHOT).getInputStream()) {
            properties.load(source);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + SNAPSHOT, e);
        }
        return properties.stringPropertyNames().stream()
                .collect(Collectors.toMap(name -> name, properties::getProperty));
    }
}
