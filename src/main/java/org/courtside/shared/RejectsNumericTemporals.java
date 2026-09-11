package org.courtside.shared;

import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.databind.BeanDescription;
import tools.jackson.databind.BeanProperty;
import tools.jackson.databind.DeserializationConfig;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.deser.ValueDeserializerModifier;
import tools.jackson.databind.module.SimpleModule;

import java.time.temporal.Temporal;
import java.util.Set;

// The java.time readers take a number as an epoch of their own choosing, which the coercion
// configuration does not reach, so 1700000000000 for a date-time read as the year 55840.
@Component
class RejectsNumericTemporals extends SimpleModule {

    RejectsNumericTemporals() {
        super("courtside-textual-instants");
        setDeserializerModifier(new ValueDeserializerModifier() {
            @Override
            public ValueDeserializer<?> modifyDeserializer(DeserializationConfig config,
                    BeanDescription.Supplier beanDescription, ValueDeserializer<?> deserializer) {
                if (!Temporal.class.isAssignableFrom(beanDescription.getBeanClass())) {
                    return deserializer;
                }
                return new ReadsOnlyText(deserializer, beanDescription.getBeanClass());
            }
        });
    }

    private static final class ReadsOnlyText extends ValueDeserializer<Object> {

        private static final Set<JsonToken> NUMERIC =
                Set.of(JsonToken.VALUE_NUMBER_INT, JsonToken.VALUE_NUMBER_FLOAT);

        private final ValueDeserializer<?> delegate;
        private final Class<?> temporal;

        private ReadsOnlyText(ValueDeserializer<?> delegate, Class<?> temporal) {
            this.delegate = delegate;
            this.temporal = temporal;
        }

        @Override
        public void resolve(DeserializationContext context) {
            delegate.resolve(context);
        }

        @Override
        public ValueDeserializer<?> createContextual(
                DeserializationContext context, BeanProperty property) {
            return new ReadsOnlyText(delegate.createContextual(context, property), temporal);
        }

        @Override
        public Object deserialize(JsonParser parser, DeserializationContext context) {
            if (NUMERIC.contains(parser.currentToken())) {
                return context.handleUnexpectedToken(context.constructType(temporal), parser);
            }
            return delegate.deserialize(parser, context);
        }
    }
}
