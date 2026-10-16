package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.config.ClubIdentity;
import org.courtside.notification.MessageKind;
import org.courtside.notification.MessageTemplateEvent;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class MessageTemplateService {

    private final MessageTemplateOverrides overrides;
    private final ClubIdentity club;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public record Template(MessageKind kind, List<String> placeholders, List<String> required,
                           List<Wording> languages) {
    }

    public record Wording(String language, MessageText shipped, Optional<MessageText> own) {
    }

    @Transactional(readOnly = true)
    public List<Template> templates() {
        List<MessageTemplateOverrides.Stored> stored = overrides.all();
        return Arrays.stream(MessageKind.values())
                .map(kind -> new Template(kind,
                        List.copyOf(MessageTemplateCatalog.placeholders(kind)),
                        List.copyOf(MessageTemplateCatalog.required(kind)),
                        MessageTemplateCatalog.LANGUAGES.stream()
                                .map(language -> new Wording(language, MessageTemplateCatalog.shipped(kind, language),
                                        stored.stream()
                                                .filter(own -> own.kind() == kind && own.language().equals(language))
                                                .map(MessageTemplateOverrides.Stored::text)
                                                .findFirst()))
                                .toList()))
                .toList();
    }

    @Transactional
    public void change(MessageKind kind, String language, MessageText text) {
        requireAcceptable(kind, language, text);
        overrides.store(kind, language, text, clock.instant());
        events.publishEvent(new MessageTemplateEvent.Changed(kind, language));
    }

    @Transactional
    public void reset(MessageKind kind, String language) {
        requireKnown(language);
        if (overrides.remove(kind, language)) {
            events.publishEvent(new MessageTemplateEvent.Reset(kind, language));
        }
    }

    @Transactional(readOnly = true)
    public MessageText preview(MessageKind kind, String language, MessageText text) {
        requireAcceptable(kind, language, text);
        Map<String, String> samples = MessageTemplateSamples.of(language, club.clubName());
        return new MessageText(MailTemplates.fill(kind.templateKey() + ".subject", text.subject(), samples),
                MailTemplates.fill(kind.templateKey() + ".body", text.body(), samples));
    }

    private static void requireAcceptable(MessageKind kind, String language, MessageText text) {
        if (text == null || text.subject() == null || text.body() == null) {
            throw new IllegalStateException("A message wording reached the service without a subject and body");
        }
        requireKnown(language);
        List<MessageTemplateCatalog.Violation> violations = MessageTemplateCatalog.check(kind, text);
        if (!violations.isEmpty()) {
            throw new MessageTemplateRefusedException(violations);
        }
    }

    private static void requireKnown(String language) {
        if (!MessageTemplateCatalog.LANGUAGES.contains(language)) {
            throw new MessageTemplateRefusedException(
                    List.of(new MessageTemplateCatalog.Violation("messageTemplate.language.unknown", null)));
        }
    }
}
