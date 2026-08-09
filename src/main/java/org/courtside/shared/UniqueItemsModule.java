package org.courtside.shared;

import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.BeanProperty;
import tools.jackson.databind.DeserializationConfig;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.deser.ValueDeserializerModifier;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.type.CollectionType;

import java.util.HashSet;
import java.util.Set;

// Every array the API document declares uniqueItems arrives as a Set, and a Set makes a duplicate
// disappear: ["A", "A"] would be read as one court, the request would succeed, and the caller
// would believe two were booked — the response carries no court list to tell them otherwise.
//
// JSON Schema calls a document with duplicates invalid, so silently accepting one means the server
// does not honour its own published contract. This rejects it instead, once and for every such
// array, present and future.
//
// Deliberately a Jackson module rather than a generator template or a mapped collection type: the
// runtime's own extension point survives a generator upgrade, and the generated models stay
// exactly what the generator produces.
@Component
class UniqueItemsModule extends SimpleModule {

    UniqueItemsModule() {
        super("courtside-unique-items");
        setDeserializerModifier(new ValueDeserializerModifier() {
            @Override
            public ValueDeserializer<?> modifyCollectionDeserializer(
                    DeserializationConfig config, CollectionType type,
                    tools.jackson.databind.BeanDescription.Supplier beanDescription,
                    ValueDeserializer<?> deserializer) {
                if (!Set.class.isAssignableFrom(type.getRawClass())) {
                    return deserializer;
                }
                return new RejectsDuplicates(deserializer);
            }
        });
    }

    private static final class RejectsDuplicates extends ValueDeserializer<Object> {

        private final ValueDeserializer<?> delegate;

        private RejectsDuplicates(ValueDeserializer<?> delegate) {
            this.delegate = delegate;
        }

        // A collection deserializer learns what its elements are through these two calls. A wrapper
        // that answers them itself leaves the delegate holding nothing, and every Set in the API
        // stops reading — including the ones with no duplicate in them.
        @Override
        public void resolve(DeserializationContext context) {
            delegate.resolve(context);
        }

        @Override
        public ValueDeserializer<?> createContextual(DeserializationContext context, BeanProperty property) {
            return new RejectsDuplicates(delegate.createContextual(context, property));
        }

        @Override
        public Object deserialize(JsonParser parser, DeserializationContext context) {
            JsonNode array = context.readTree(parser);
            if (array.isArray()) {
                Set<JsonNode> seen = new HashSet<>();
                for (JsonNode element : array) {
                    if (!seen.add(element)) {
                        // Thrown through Jackson so the property path travels with it; the advice
                        // turns that path into the field a client has to correct.
                        throw new DuplicateItemException(context, parser, element.toString());
                    }
                }
            }
            // A parser replaying a tree starts before its first token; handing it over unadvanced
            // gives the delegate nothing to read.
            JsonParser replay = array.traverse(context);
            replay.nextToken();
            return delegate.deserialize(replay, context);
        }
    }
}
