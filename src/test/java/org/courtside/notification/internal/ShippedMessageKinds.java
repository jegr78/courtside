package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

final class ShippedMessageKinds {

    static final Set<MessageKind> CREDENTIAL = Set.of(MessageKind.CREDENTIALS_NEW_ACCOUNT,
            MessageKind.CREDENTIALS_PASSWORD_RESET, MessageKind.ACCOUNT_PASSWORD_RESET_CODE,
            MessageKind.ACCOUNT_USERNAME_REMINDER, MessageKind.ACCOUNT_MFA_RECOVERY_CODE);
    static final Set<MessageKind> LINKED = Stream.of(MessageKind.values())
            .filter(kind -> !CREDENTIAL.contains(kind)).collect(Collectors.toUnmodifiableSet());

    private ShippedMessageKinds() {
    }
}
