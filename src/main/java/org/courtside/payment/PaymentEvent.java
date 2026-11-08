package org.courtside.payment;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public sealed interface PaymentEvent extends DomainEventRecord {

    UUID settingsId();

    @Override
    default UUID subjectId() {
        return settingsId();
    }

    record PayPalSettingsChanged(UUID settingsId, PayPalEnvironment environment, boolean enabled,
                                 boolean clientIdChanged, boolean secretReplaced) implements PaymentEvent {

        static final String TYPE = "payment.paypal.settings.changed";

        @Override
        public String eventType() {
            return TYPE;
        }
    }

    record PayPalCredentialsRemoved(UUID settingsId) implements PaymentEvent {

        static final String TYPE = "payment.paypal.credentials.removed";

        @Override
        public String eventType() {
            return TYPE;
        }
    }
}
