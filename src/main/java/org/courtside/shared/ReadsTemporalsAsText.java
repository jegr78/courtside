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

import tools.jackson.databind.type.LogicalType;

import java.time.temporal.Temporal;
import java.util.Set;

// The java.time readers take a number as an epoch and an array as the components of a date, neither
// of which the coercion configuration reaches, so 1700000000000 read as the year 55840.
@Component
class ReadsTemporalsAsText extends SimpleModule {

    ReadsTemporalsAsText() {
        super("courtside-textual-temporals");
        setDeserializerModifier(new ValueDeserializerModifier() {
            @Override
            public ValueDeserializer<?> modifyDeserializer(DeserializationConfig config,
                    BeanDescription.Supplier beanDescription, ValueDeserializer<?> deserializer) {
                if (!Temporal.class.isAssignableFrom(beanDescription.getBeanClass())) {
                    return deserializer;
                }
                return new OnlyFromText(deserializer, beanDescription.getBeanClass());
            }
        });
    }

    private static final class OnlyFromText extends ValueDeserializer<Object> {

        private static final Set<JsonToken> TEXT =
                Set.of(JsonToken.VALUE_STRING, JsonToken.VALUE_NULL);

        private final ValueDeserializer<?> delegate;
        private final Class<?> temporal;

        private OnlyFromText(ValueDeserializer<?> delegate, Class<?> temporal) {
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
            return new OnlyFromText(delegate.createContextual(context, property), temporal);
        }

        @Override
        public Object getNullValue(DeserializationContext context) {
            return delegate.getNullValue(context);
        }

        @Override
        public Class<?> handledType() {
            return delegate.handledType();
        }

        @Override
        public LogicalType logicalType() {
            return delegate.logicalType();
        }

        @Override
        public Object deserialize(JsonParser parser, DeserializationContext context) {
            if (!TEXT.contains(parser.currentToken())) {
                return context.handleUnexpectedToken(context.constructType(temporal), parser);
            }
            return delegate.deserialize(parser, context);
        }
    }
}
