package org.courtside.notification;

// The message's own name, which is the key its template carries — not the reason another module
// had for asking, so a booking confirmation can join without the record learning about identity.
public enum MessageKind {

    CREDENTIALS_NEW_ACCOUNT("credentials.newAccount"),
    CREDENTIALS_PASSWORD_RESET("credentials.passwordReset");

    private final String templateKey;

    MessageKind(String templateKey) {
        this.templateKey = templateKey;
    }

    public String templateKey() {
        return templateKey;
    }
}
