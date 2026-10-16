package org.courtside.notification.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.AdminMessageTemplatesApi;
import org.courtside.api.ApiMessageKind;
import org.courtside.api.ApiMessageTemplate;
import org.courtside.api.ApiMessageTemplateLanguage;
import org.courtside.api.ApiMessageTemplateText;
import org.courtside.api.ApiMessageTemplateWording;
import org.courtside.notification.MessageKind;
import org.courtside.notification.internal.MessageTemplateService;
import org.courtside.notification.internal.MessageText;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequiredArgsConstructor
class MessageTemplateAdminController implements AdminMessageTemplatesApi {

    private final MessageTemplateService templates;

    @Override
    public ResponseEntity<List<ApiMessageTemplate>> listMessageTemplates() {
        return ResponseEntity.ok(templates.templates().stream()
                .map(template -> new ApiMessageTemplate(ApiMessageKind.fromValue(template.kind().name()),
                        template.placeholders(), template.required(),
                        template.languages().stream().map(MessageTemplateAdminController::toResponse).toList()))
                .toList());
    }

    @Override
    public ResponseEntity<Void> changeMessageTemplate(ApiMessageKind kind, ApiMessageTemplateLanguage language,
                                                      ApiMessageTemplateText text) {
        templates.change(MessageKind.valueOf(kind.getValue()), language.getValue(), toText(text));
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> resetMessageTemplate(ApiMessageKind kind, ApiMessageTemplateLanguage language) {
        templates.reset(MessageKind.valueOf(kind.getValue()), language.getValue());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<ApiMessageTemplateText> previewMessageTemplate(ApiMessageKind kind,
                                                                         ApiMessageTemplateLanguage language,
                                                                         ApiMessageTemplateText text) {
        MessageText preview = templates.preview(MessageKind.valueOf(kind.getValue()), language.getValue(), toText(text));
        return ResponseEntity.ok(new ApiMessageTemplateText(preview.subject(), preview.body()));
    }

    private static ApiMessageTemplateWording toResponse(MessageTemplateService.Wording wording) {
        return new ApiMessageTemplateWording(ApiMessageTemplateLanguage.fromValue(wording.language()),
                new ApiMessageTemplateText(wording.shipped().subject(), wording.shipped().body()))
                .own(wording.own().map(own -> new ApiMessageTemplateText(own.subject(), own.body())).orElse(null));
    }

    private static MessageText toText(ApiMessageTemplateText text) {
        return new MessageText(text.getSubject(), text.getBody());
    }
}
