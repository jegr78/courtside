package org.courtside.notification.internal;

import org.springframework.boot.context.properties.ConfigurationProperties;

// Mail is not optional for a club that runs this: a member who cannot be reached cannot be given an
// account, so an instance without these does not start rather than failing at the first message.
@ConfigurationProperties(prefix = "courtside.mail")
public record MailProperties(String host, int port, String from, String replyTo,
                             String username, String password, boolean trustRelayCertificate) {

    @Override
    public String toString() {
        return "MailProperties[host=%s, port=%d, from=%s, replyTo=%s, username=%s, password=%s, "
                .formatted(host, port, from, replyTo, username, password == null ? "unset" : "set")
                + "trustRelayCertificate=%b]".formatted(trustRelayCertificate);
    }
}
