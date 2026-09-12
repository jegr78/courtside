package org.courtside.shared;

import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.Yaml;
import tools.jackson.databind.cfg.MapperConfig;
import tools.jackson.databind.introspect.Annotated;
import tools.jackson.databind.introspect.AnnotatedMember;
import tools.jackson.databind.introspect.NopAnnotationIntrospector;
import tools.jackson.databind.module.SimpleModule;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

// The generator writes Nulls.SKIP wherever it believes the document forbids null, which reads an
// explicit null as absence; and it loses the belief altogether when a schema composes another.
@Component
class RejectsUndeclaredNulls extends SimpleModule {

    private static final String MODEL_PREFIX = "Api";

    private final Set<String> nullable = nullableProperties();

    RejectsUndeclaredNulls() {
        super("courtside-undeclared-nulls");
    }

    @Override
    public void setupModule(SetupContext context) {
        super.setupModule(context);
        context.insertAnnotationIntrospector(new NopAnnotationIntrospector() {
            @Override
            public JsonSetter.Value findSetterInfo(MapperConfig<?> config, Annotated annotated) {
                JsonSetter declared = annotated.getAnnotation(JsonSetter.class);
                if (declared == null || declared.nulls() != Nulls.SKIP
                        || !(annotated instanceof AnnotatedMember member)) {
                    return null;
                }
                return JsonSetter.Value.forValueNulls(
                        nullable.contains(keyOf(member)) ? Nulls.SET : Nulls.FAIL);
            }
        });
    }

    private static String keyOf(AnnotatedMember member) {
        String model = member.getDeclaringClass().getSimpleName();
        return (model.startsWith(MODEL_PREFIX) ? model.substring(MODEL_PREFIX.length()) : model)
                + "." + propertyOf(member.getName());
    }

    private static String propertyOf(String accessor) {
        for (String prefix : List.of("set", "get", "is")) {
            if (accessor.startsWith(prefix) && accessor.length() > prefix.length()) {
                return Character.toLowerCase(accessor.charAt(prefix.length()))
                        + accessor.substring(prefix.length() + 1);
            }
        }
        return accessor;
    }

    @SuppressWarnings("unchecked")
    private static Set<String> nullableProperties() {
        Map<String, Object> document = load();
        Map<String, Object> schemas = (Map<String, Object>)
                ((Map<String, Object>) document.get("components")).get("schemas");
        Set<String> declared = new HashSet<>();
        schemas.forEach((name, schema) ->
                collect(name, schema, schemas, declared, new HashSet<>()));
        return Set.copyOf(declared);
    }

    @SuppressWarnings("unchecked")
    private static void collect(String name, Object schema, Map<String, Object> schemas,
            Set<String> declared, Set<Object> visiting) {
        if (!(schema instanceof Map<?, ?> node) || !visiting.add(schema)) {
            return;
        }
        if (node.get("$ref") instanceof String reference) {
            collect(name, schemas.get(reference.substring(reference.lastIndexOf('/') + 1)),
                    schemas, declared, visiting);
        }
        for (String composition : List.of("allOf", "oneOf", "anyOf")) {
            if (node.get(composition) instanceof List<?> parts) {
                parts.forEach(part -> collect(name, part, schemas, declared, visiting));
            }
        }
        if (node.get("properties") instanceof Map<?, ?> properties) {
            ((Map<String, Object>) properties).forEach((property, definition) -> {
                if (writesNull(definition, schemas, new HashSet<>())) {
                    declared.add(name + "." + property);
                }
            });
        }
    }

    @SuppressWarnings("unchecked")
    private static boolean writesNull(Object definition, Map<String, Object> schemas, Set<Object> visiting) {
        if (!(definition instanceof Map<?, ?> node) || !visiting.add(definition)) {
            return false;
        }
        if (node.get("$ref") instanceof String reference) {
            return writesNull(schemas.get(reference.substring(reference.lastIndexOf('/') + 1)),
                    schemas, visiting);
        }
        if (node.get("type") instanceof List<?> kinds && kinds.contains("null")) {
            return true;
        }
        return List.of("allOf", "oneOf", "anyOf").stream()
                .map(node::get)
                .anyMatch(parts -> parts instanceof List<?> members && ((List<Object>) members).stream()
                        .anyMatch(part -> writesNull(part, schemas, visiting)));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> load() {
        try (InputStream document = new ClassPathResource("api/openapi.yaml").getInputStream()) {
            return (Map<String, Object>) new Yaml().load(document);
        } catch (IOException unreadable) {
            throw new UncheckedIOException("The API document must ship on the classpath", unreadable);
        }
    }
}
