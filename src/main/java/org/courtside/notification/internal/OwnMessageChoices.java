package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.identity.CurrentUser;
import org.courtside.notification.MessageChannel;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageNotDeclinableException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class OwnMessageChoices {

    private final CurrentUser currentUser;
    private final MessageChoices choices;
    private final MessageChannels channels;

    @Transactional(readOnly = true)
    public List<MessageChoiceView> current() {
        Set<MessageKind> declined = Set.copyOf(choices.declinedBy(accountId()));
        return Arrays.stream(MessageKind.values())
                .map(kind -> new MessageChoiceView(kind, kind.isDeclinable(), !declined.contains(kind)))
                .toList();
    }

    @Transactional
    public void choose(List<MessageKind> declined) {
        declined.stream()
                .filter(kind -> !kind.isDeclinable())
                .findFirst()
                .ifPresent(kind -> {
                    throw new MessageNotDeclinableException(kind);
                });
        UUID accountId = accountId();
        for (MessageKind kind : MessageKind.values()) {
            if (!kind.isDeclinable()) continue;
            if (declined.contains(kind)) {
                choices.decline(accountId, kind);
            } else {
                choices.accept(accountId, kind);
            }
        }
    }

    @Transactional(readOnly = true)
    public List<ChannelChoiceView> currentChannels() {
        Set<MessageChannel> declined = Set.copyOf(channels.declinedBy(accountId()));
        return Arrays.stream(MessageChannel.values())
                .map(channel -> new ChannelChoiceView(channel, !declined.contains(channel)))
                .toList();
    }

    @Transactional
    public void chooseChannels(List<MessageChannel> declined) {
        UUID accountId = accountId();
        for (MessageChannel channel : MessageChannel.values()) {
            if (declined.contains(channel)) {
                channels.decline(accountId, channel);
            } else {
                channels.accept(accountId, channel);
            }
        }
    }

    private UUID accountId() {
        return currentUser.requireAccount().getId();
    }

    public record MessageChoiceView(MessageKind kind, boolean declinable, boolean enabled) {
    }

    public record ChannelChoiceView(MessageChannel channel, boolean enabled) {
    }
}
