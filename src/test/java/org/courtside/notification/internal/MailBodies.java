package org.courtside.notification.internal;

import jakarta.mail.Multipart;

final class MailBodies {

    private MailBodies() {
    }

    static String textOf(Object content) throws Exception {
        return content instanceof Multipart multipart
                ? textOf(multipart.getBodyPart(0).getContent()) : content.toString();
    }
}
