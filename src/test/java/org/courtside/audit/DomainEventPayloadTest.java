package org.courtside.audit;

import org.courtside.shared.DomainEventRecord;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.type.filter.AssignableTypeFilter;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
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

    private static String eventTypeOf(Class<?> type) {
        try {
            Constructor<?> constructor = type.getDeclaredConstructors()[0];
            constructor.setAccessible(true);
            return ((DomainEventRecord) constructor.newInstance(blankArguments(constructor))).eventType();
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot read the event type of " + type.getName(), e);
        }
    }

    private static Object[] blankArguments(Constructor<?> constructor) {
        List<Object> arguments = new ArrayList<>();
        for (Class<?> parameter : constructor.getParameterTypes()) {
            arguments.add(parameter.isPrimitive() ? blankPrimitive(parameter) : null);
        }
        return arguments.toArray();
    }

    private static Object blankPrimitive(Class<?> parameter) {
        if (parameter == boolean.class) return false;
        if (parameter == long.class) return 0L;
        if (parameter == double.class) return 0d;
        return 0;
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
