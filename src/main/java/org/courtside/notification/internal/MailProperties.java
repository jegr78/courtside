package org.courtside.notification.internal;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

// Mail is not optional for a club that runs this: a member who cannot be reached cannot be given an
// account, so an instance without these does not start rather than failing at the first message.
@Validated
@ConfigurationProperties(prefix = "courtside.mail")
public record MailProperties(@NotBlank String host, int port,
                             @NotBlank @Email String from,
                             @NotBlank @Email String replyTo,
                             String username, String password) {
}
