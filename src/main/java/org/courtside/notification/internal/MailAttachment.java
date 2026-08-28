package org.courtside.notification.internal;

record MailAttachment(String filename, String contentType, byte[] content) {

    MailAttachment {
        content = content.clone();
    }

    @Override
    public byte[] content() {
        return content.clone();
    }
}
