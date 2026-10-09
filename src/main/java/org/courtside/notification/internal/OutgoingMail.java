package org.courtside.notification.internal;

import java.util.Optional;

record OutgoingMail(String address, String subject, String body, Optional<MailAttachment> attachment) {

    OutgoingMail(String address, String subject, String body) {
        this(address, subject, body, Optional.empty());
    }

    OutgoingMail(String address, String subject, String body, MailAttachment attachment) {
        this(address, subject, body, Optional.of(attachment));
    }
}
