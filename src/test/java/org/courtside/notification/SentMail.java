package org.courtside.notification;

import jakarta.mail.internet.MimeMessage;
import org.springframework.mail.javamail.JavaMailSender;

import java.util.List;

import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.verify;

record SentMail(JavaMailSender sender) {

    List<Object> bodiesTo(String address) {
        var captured = forClass(MimeMessage.class);
        verify(sender, atLeast(0)).send(captured.capture());
        return captured.getAllValues().stream()
                .filter(message -> address.equals(recipientOf(message)))
                .map(SentMail::contentOf)
                .toList();
    }

    private static Object contentOf(MimeMessage message) {
        try {
            return message.getContent();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String recipientOf(MimeMessage message) {
        try {
            return message.getAllRecipients()[0].toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
