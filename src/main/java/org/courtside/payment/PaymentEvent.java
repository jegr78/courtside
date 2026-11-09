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

    record PayPalVoided(UUID bookingId, String orderId, String reason) implements PaymentEvent {

        static final String TYPE = "payment.paypal.voided";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record PayPalRefundRequested(UUID bookingId, String orderId, PayPalEnvironment environment, int amountMinor,
                                 String currency) implements PaymentEvent {

        static final String TYPE = "payment.paypal.refund.requested";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record PayPalRefunded(UUID bookingId, UUID accountId, String orderId, PayPalEnvironment environment,
                          String refundId, int amountMinor, String currency, boolean anonymised)
            implements PaymentEvent {

        static final String TYPE = "payment.paypal.refunded";

        @Override
        public String eventType() {
            return TYPE;
        }

        @Override
        public UUID subjectId() {
            return bookingId;
        }
    }

    record PayPalRefundFailed(UUID bookingId, String orderId, PayPalEnvironment environment, int amountMinor,
                              String currency, String reason) implements PaymentEvent {

        static final String TYPE = "payment.paypal.refundFailed";

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
