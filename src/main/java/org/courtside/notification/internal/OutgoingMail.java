package org.courtside.notification.internal;

import org.jspecify.annotations.Nullable;

import java.util.Optional;
import java.util.UUID;

record OutgoingMail(String address, String subject, String body, Optional<MailAttachment> attachment,
                    @Nullable UUID accessCodeFollows) {

    OutgoingMail(String address, String subject, String body) {
        this(address, subject, body, Optional.empty(), null);
    }

    OutgoingMail(String address, String subject, String body, MailAttachment attachment) {
        this(address, subject, body, Optional.of(attachment), null);
    }

    /** Marks the mail as promising that the booking's own code follows in a mail of its own. */
    OutgoingMail promisingAccessCodeOf(UUID bookingId) {
        return new OutgoingMail(address, subject, body, attachment, bookingId);
    }
}
