package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;

import java.util.Set;
import java.util.function.Consumer;

// Composing runs in the transaction the handover runs in, so whatever it stores is undone by a
// handover that fails.
interface MessageComposer {

    Set<MessageKind> kinds();

    void compose(QueuedMessage message, Consumer<OutgoingMail> handOver);
}
