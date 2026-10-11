package org.courtside.notification.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AccountMessagesApi;
import org.courtside.api.ApiMessageChannel;
import org.courtside.api.ApiMessageChannelChoice;
import org.courtside.api.ApiMessageChannelChoiceRequest;
import org.courtside.api.ApiMessageChoice;
import org.courtside.api.ApiMessageChoiceRequest;
import org.courtside.api.ApiMessageKind;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageChannel;
import org.courtside.notification.internal.OwnMessageChoices;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class MessageChoiceController implements AccountMessagesApi {

    private final OwnMessageChoices choices;

    @Override
    public ResponseEntity<List<ApiMessageChoice>> listOwnMessageChoices() {
        return ResponseEntity.ok(choices.current().stream()
                .map(choice -> new ApiMessageChoice(ApiMessageKind.fromValue(choice.kind().name()),
                        choice.declinable(), choice.enabled()))
                .toList());
    }

    @Override
    public ResponseEntity<Void> chooseOwnMessages(ApiMessageChoiceRequest request) {
        choices.choose(request.getDeclined().stream()
                .map(kind -> MessageKind.valueOf(kind.getValue()))
                .toList());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<List<ApiMessageChannelChoice>> listOwnMessageChannels() {
        return ResponseEntity.ok(choices.currentChannels().stream()
                .map(choice -> new ApiMessageChannelChoice(ApiMessageChannel.fromValue(choice.channel().name()),
                        choice.enabled()))
                .toList());
    }

    @Override
    public ResponseEntity<Void> chooseOwnMessageChannels(ApiMessageChannelChoiceRequest request) {
        choices.chooseChannels(request.getDeclined().stream()
                .map(channel -> MessageChannel.valueOf(channel.getValue()))
                .toList());
        return ResponseEntity.noContent().build();
    }
}
