package org.courtside.notification.internal;

import org.courtside.notification.MessageKind;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.SortedSet;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class MessageTemplateCatalog {

    static final List<String> LANGUAGES = List.of("de", "en");

    private static final Map<MessageKind, Set<String>> REQUIRED = Map.of(
            MessageKind.CREDENTIALS_NEW_ACCOUNT, Set.of("username", "credential"),
            MessageKind.CREDENTIALS_PASSWORD_RESET, Set.of("username", "credential"),
            MessageKind.ACCOUNT_PASSWORD_RESET_CODE, Set.of("username", "resetCode"),
            MessageKind.ACCOUNT_USERNAME_REMINDER, Set.of("username"));

    // A subject is shown on lock screens and in message lists, so a secret never travels in one.
    private static final Set<String> SECRET = Set.of("credential", "resetCode");
    private static final Pattern STANDALONE = Pattern.compile("[\"'\u00ab\u00bb\u201a\u201e\u2018\u2019\u201c\u201d()\\[\\].,;:!]*");
    private static final Pattern LINE_BREAK = Pattern.compile("[\r\n\u0085  ]");
    private static final Pattern CONTROL = Pattern.compile("\\p{Cc}");
    private static final Pattern WORD = Pattern.compile("\\S+");

    record Violation(String code, String placeholder) {
    }

    private MessageTemplateCatalog() {
    }

    static MessageText shipped(MessageKind kind, String language) {
        Locale locale = Locale.forLanguageTag(language);
        return new MessageText(MailTemplates.shipped(kind.templateKey() + ".subject", locale),
                MailTemplates.shipped(kind.templateKey() + ".body", locale));
    }

    // What the message's mailer provides: everything a shipped wording names, and the link to the instance.
    static SortedSet<String> placeholders(MessageKind kind) {
        SortedSet<String> names = new TreeSet<>(Set.of(InstanceLinks.PLACEHOLDER));
        for (String language : LANGUAGES) {
            MessageText text = shipped(kind, language);
            names.addAll(namedIn(text.subject()));
            names.addAll(namedIn(text.body()));
        }
        return names;
    }

    static SortedSet<String> required(MessageKind kind) {
        return new TreeSet<>(REQUIRED.getOrDefault(kind, Set.of()));
    }

    static List<Violation> check(MessageKind kind, MessageText text) {
        List<Violation> violations = new ArrayList<>();
        if (LINE_BREAK.matcher(text.subject()).find()) {
            violations.add(new Violation("messageTemplate.subject.lineBreak", null));
        }
        if (CONTROL.matcher(text.subject().replaceAll(LINE_BREAK.pattern(), "")).find()
                || CONTROL.matcher(text.body().replaceAll("[\n\r\t]", "")).find()) {
            violations.add(new Violation("messageTemplate.text.controlCharacter", null));
        }
        SortedSet<String> known = placeholders(kind);
        SortedSet<String> named = new TreeSet<>(namedIn(text.subject()));
        named.addAll(namedIn(text.body()));
        named.stream().filter(name -> !known.contains(name))
                .forEach(name -> violations.add(new Violation("messageTemplate.placeholder.unknown", name)));
        required(kind).stream().filter(name -> !namedIn(text.body()).contains(name))
                .forEach(name -> violations.add(new Violation("messageTemplate.placeholder.missing", name)));
        namedIn(text.subject()).stream().filter(SECRET::contains)
                .forEach(name -> violations.add(new Violation("messageTemplate.placeholder.secretInSubject", name)));
        gluedSecrets(text.body())
                .forEach(name -> violations.add(new Violation("messageTemplate.placeholder.secretInLink", name)));
        return violations;
    }

    // A secret glued to other text could become part of a link that carries it to somebody else.
    private static SortedSet<String> gluedSecrets(String body) {
        SortedSet<String> glued = new TreeSet<>();
        Matcher word = WORD.matcher(body);
        while (word.find()) {
            Matcher placeholder = MailTemplates.PLACEHOLDER.matcher(word.group());
            while (placeholder.find()) {
                String name = placeholder.group(1);
                if (SECRET.contains(name)
                        && !STANDALONE.matcher(word.group().replace(placeholder.group(), "")).matches()) {
                    glued.add(name);
                }
            }
        }
        return glued;
    }

    static SortedSet<String> namedIn(String template) {
        SortedSet<String> names = new TreeSet<>();
        Matcher matcher = MailTemplates.PLACEHOLDER.matcher(template);
        while (matcher.find()) {
            names.add(matcher.group(1));
        }
        return names;
    }
}
