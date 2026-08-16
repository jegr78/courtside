package org.courtside.member.web;

import org.courtside.api.ApiPersonRequest;
import org.courtside.member.internal.PersonText;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.BeanDescription;
import tools.jackson.databind.BeanProperty;
import tools.jackson.databind.DeserializationConfig;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.deser.ValueDeserializerModifier;
import tools.jackson.databind.module.SimpleModule;

// Reading is the last point before validation, and the document states the padding is gone
// before maxLength and format are checked.
@Component
class PersonPaddingModule extends SimpleModule {

    PersonPaddingModule() {
        super("courtside-person-padding");
        setDeserializerModifier(new ValueDeserializerModifier() {
            @Override
            public ValueDeserializer<?> modifyDeserializer(
                    DeserializationConfig config, BeanDescription.Supplier beanDescription,
                    ValueDeserializer<?> deserializer) {
                if (!ApiPersonRequest.class.equals(beanDescription.getBeanClass())) {
                    return deserializer;
                }
                return new StripsPadding(deserializer);
            }
        });
    }

    private static final class StripsPadding extends ValueDeserializer<Object> {

        private final ValueDeserializer<?> delegate;

        private StripsPadding(ValueDeserializer<?> delegate) {
            this.delegate = delegate;
        }

        @Override
        public void resolve(DeserializationContext context) {
            delegate.resolve(context);
        }

        @Override
        public ValueDeserializer<?> createContextual(DeserializationContext context, BeanProperty property) {
            return new StripsPadding(delegate.createContextual(context, property));
        }

        @Override
        public Object deserialize(JsonParser parser, DeserializationContext context) {
            ApiPersonRequest request = (ApiPersonRequest) delegate.deserialize(parser, context);
            request.setFirstName(PersonText.stripped(request.getFirstName()));
            request.setLastName(PersonText.stripped(request.getLastName()));
            request.setEmail(PersonText.stripped(request.getEmail()));
            return request;
        }
    }
}
