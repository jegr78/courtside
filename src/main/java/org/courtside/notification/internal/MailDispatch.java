package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
class MailDispatch {

    private final JavaMailSender sender;
    private final MailProperties properties;

    // The identifier is known before the message leaves, so the record of it needs no reply from a
    // mail server to parse, and it survives a club pointing the instance at a different one.
    String send(String recipient, String subject, String body, String messageId) {
        try {
            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, false, StandardCharsets.UTF_8.name());
            helper.setFrom(properties.from());
            helper.setReplyTo(properties.replyTo());
            helper.setTo(recipient);
            helper.setSubject(subject);
            helper.setText(body, false);
            message.setHeader("Message-ID", messageId);
            sender.send(message);
            return messageId;
        } catch (Exception failure) {
            throw new MailHandoverFailedException(messageId, failure);
        }
    }

    static String newMessageId(String domain) {
        return "<" + UUID.randomUUID() + "@" + domain + ">";
    }
}
