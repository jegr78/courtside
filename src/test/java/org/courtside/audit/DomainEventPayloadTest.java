package org.courtside.audit;

import org.courtside.audit.testfixture.DomainEventTypes;
import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.type.filter.AssignableTypeFilter;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class DomainEventPayloadTest {

    private static final String SNAPSHOT = "domain-event-payload.properties";
    private static final String NULLABLE_SNAPSHOT = "domain-event-nullable-field.properties";

    @Test
    void givenAStoredEvent_whenItsRecordChanges_thenOnlyAddedFieldsLeaveOlderRowsReadable() {
        // given
        Map<String, String> recorded = snapshot(SNAPSHOT);

        // when
        Map<String, String> published = publishedPayloads();

        // then
        assertThat(published).as(
                        "A stored row is read years after it was written. A field that disappears or is "
                                + "renamed makes it unreadable, so that change needs a new event type. A field "
                                + "that is added is fine and belongs in " + SNAPSHOT + ".")
                .containsExactlyInAnyOrderEntriesOf(recorded);
    }

    @Test
    void givenAnEventRecord_whenAComponentIsNullable_thenTheCheckedInInventoryNamesIt() {
        // given
        Map<String, String> recorded = snapshot(NULLABLE_SNAPSHOT);

        // when
        Map<String, String> declared = nullableFields();

        // then
        assertThat(declared).as(
                        "A message interpolating a field that can be null needs a null-safe variant, and "
                                + "the guard over those variants reads " + NULLABLE_SNAPSHOT + ". A component "
                                + "annotated @Nullable belongs in it.")
                .containsExactlyInAnyOrderEntriesOf(recorded);
    }

    @Test
    void givenAnEventRecord_whenItsNullabilityIsRead_thenItsScopeIsNullMarked() {
        // when
        List<Class<?>> unmarked = domainEventRecordClasses().stream()
                .filter(type -> !isNullMarked(type))
                .toList();

        // then
        assertThat(unmarked).as(
                        "Outside a null-marked scope an unannotated reference component says nothing, so "
                                + "the nullable inventory could not tell a missing @Nullable from a field "
                                + "that never holds null.")
                .isEmpty();
    }

    static Set<String> publishedTypes() {
        return domainEventRecordClasses().stream()
                .map(DomainEventTypes::typeOf)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private static Map<String, String> publishedPayloads() {
        Map<String, String> payloads = new LinkedHashMap<>();
        domainEventRecordClasses().forEach(type -> payloads.put(DomainEventTypes.typeOf(type), fieldsOf(type)));
        return payloads;
    }

    private static List<Class<?>> domainEventRecordClasses() {
        ClassPathScanningCandidateComponentProvider scan =
                new ClassPathScanningCandidateComponentProvider(false);
        scan.addIncludeFilter(new AssignableTypeFilter(DomainEventRecord.class));
        List<Class<?>> classes = new ArrayList<>();
        scan.findCandidateComponents("org.courtside").forEach(candidate -> {
            Class<?> type = loadClass(candidate.getBeanClassName());
            if (type.isRecord()) {
                classes.add(type);
            }
        });
        return classes;
    }

    private static Map<String, String> nullableFields() {
        Map<String, String> nullable = new LinkedHashMap<>();
        domainEventRecordClasses().forEach(type -> {
            String fields = Arrays.stream(type.getRecordComponents())
                    .filter(component -> component.getAnnotatedType().getAnnotation(Nullable.class) != null)
                    .map(RecordComponent::getName)
                    .collect(Collectors.joining(","));
            if (!fields.isEmpty()) {
                nullable.put(DomainEventTypes.typeOf(type), fields);
            }
        });
        return nullable;
    }

    private static boolean isNullMarked(Class<?> type) {
        for (Class<?> scope = type; scope != null; scope = scope.getEnclosingClass()) {
            if (scope.isAnnotationPresent(NullMarked.class)) {
                return true;
            }
        }
        return type.getPackage().isAnnotationPresent(NullMarked.class);
    }

    private static String fieldsOf(Class<?> type) {
        return Arrays.stream(type.getRecordComponents())
                .map(RecordComponent::getName)
                .collect(Collectors.joining(","));
    }

    private static Class<?> loadClass(String name) {
        try {
            return Class.forName(name);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("Cannot load " + name, e);
        }
    }

    private static Map<String, String> snapshot(String resource) {
        Properties properties = new Properties();
        try (InputStream source = new ClassPathResource(resource).getInputStream()) {
            properties.load(source);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + resource, e);
        }
        return properties.stringPropertyNames().stream()
                .collect(Collectors.toMap(name -> name, properties::getProperty));
    }
}
