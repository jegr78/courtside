package org.courtside.payment;

import org.courtside.shared.DomainEventRecord;
import org.jspecify.annotations.NullMarked;

import java.util.UUID;

@NullMarked
public sealed interface PaymentEvent extends DomainEventRecord {

    record PayPalSettingsChanged(UUID settingsId, PayPalEnvironment environment, boolean enabled,
                                 boolean clientIdChanged, boolean secretReplaced) implements PaymentEvent {

        static final String TYPE = "payment.paypal.settings.changed";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return settingsId;
        }
    }

    record PayPalCredentialsRemoved(UUID settingsId) implements PaymentEvent {

        static final String TYPE = "payment.paypal.credentials.removed";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return settingsId;
        }
    }

    record PayPalOrderCreated(UUID bookingId, String orderId, PayPalEnvironment environment, int amountMinor,
                              String currency) implements PaymentEvent {

        static final String TYPE = "payment.paypal.order.created";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record PayPalCaptured(UUID bookingId, String orderId, String captureId, int amountMinor, String currency)
            implements PaymentEvent {

        static final String TYPE = "payment.paypal.captured";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record PayPalLateCapture(UUID bookingId, String orderId, String captureId, int amountMinor, String currency,
                             boolean credited) implements PaymentEvent {

        static final String TYPE = "payment.paypal.lateCapture";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record PayPalRejected(UUID bookingId, String orderId, String reason) implements PaymentEvent {

        static final String TYPE = "payment.paypal.rejected";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }
}
