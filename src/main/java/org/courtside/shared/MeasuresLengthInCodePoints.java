package org.courtside.shared;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.constraints.Size;
import org.hibernate.validator.HibernateValidatorConfiguration;
import org.hibernate.validator.cfg.ConstraintMapping;
import org.springframework.boot.validation.autoconfigure.ValidationConfigurationCustomizer;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.Map;

// minLength and maxLength count characters; the built-in validator counts UTF-16 units, so an
// emoji reads as two and the document's bounds stop meaning what they say.
@Component
class MeasuresLengthInCodePoints implements ValidationConfigurationCustomizer {

    @Override
    public void customize(jakarta.validation.Configuration<?> configuration) {
        if (!(configuration instanceof HibernateValidatorConfiguration hibernate)) {
            throw new IllegalStateException(
                    "Bean Validation is not Hibernate Validator, so @Size still counts UTF-16 units");
        }
        ConstraintMapping mapping = hibernate.createConstraintMapping();
        mapping.constraintDefinition(Size.class)
                .includeExistingValidators(false)
                .validatedBy(CharacterCount.class)
                .validatedBy(ElementCount.class)
                .validatedBy(EntryCount.class);
        hibernate.addMapping(mapping);
    }

    private static boolean within(int size, Size bounds) {
        return size >= bounds.min() && size <= bounds.max();
    }

    public static class CharacterCount implements ConstraintValidator<Size, CharSequence> {

        private Size bounds;

        @Override
        public void initialize(Size constraint) {
            bounds = constraint;
        }

        @Override
        public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
            return value == null || within((int) value.codePoints().count(), bounds);
        }
    }

    public static class ElementCount implements ConstraintValidator<Size, Collection<?>> {

        private Size bounds;

        @Override
        public void initialize(Size constraint) {
            bounds = constraint;
        }

        @Override
        public boolean isValid(Collection<?> value, ConstraintValidatorContext context) {
            return value == null || within(value.size(), bounds);
        }
    }

    public static class EntryCount implements ConstraintValidator<Size, Map<?, ?>> {

        private Size bounds;

        @Override
        public void initialize(Size constraint) {
            bounds = constraint;
        }

        @Override
        public boolean isValid(Map<?, ?> value, ConstraintValidatorContext context) {
            return value == null || within(value.size(), bounds);
        }
    }
}
