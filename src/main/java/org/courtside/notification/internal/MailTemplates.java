package org.courtside.notification.internal;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.courtside.notification.MessageKind;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.MissingResourceException;
import java.util.Optional;
import java.util.ResourceBundle;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

// Plain text, and the placeholders are named rather than positional: a translator moving a value
// inside a sentence must not have to count arguments to keep it correct.
@Slf4j
@Component
@RequiredArgsConstructor
class MailTemplates {

    static final Pattern PLACEHOLDER = Pattern.compile("\\{([a-zA-Z]+)}");
    private static final String BUNDLE = "mail";
    private static final ResourceBundle.Control SHIPPED_LANGUAGE_ONLY =
            ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES);
    private static final String EMPTY_LINK = "[ \\t]*\\{" + InstanceLinks.PLACEHOLDER + "}[ \\t]*";
    private static final Pattern EMPTY_LINK_LINE =
            Pattern.compile("^" + EMPTY_LINK + "(?:\\R|$)|\\R" + EMPTY_LINK + "(?=\\R|$)");
    private static final Map<String, MessageKind> SUBJECTS = byKey(".subject");
    private static final Map<String, MessageKind> BODIES = byKey(".body");

    private final MessageTemplateOverrides overrides;

    String render(String key, Locale locale, Map<String, String> values) {
        String shipped = shipped(key, locale);
        return own(key, locale)
                .map(wording -> fillOrNull(key, wording, values))
                .orElseGet(() -> fill(key, shipped, values));
    }

    // A club's own wording replaces a message's subject or body; the fragments inside them stay shipped.
    // A stored wording that would not pass the board's check again never reaches a member.
    private Optional<String> own(String key, Locale locale) {
        MessageKind kind = SUBJECTS.containsKey(key) ? SUBJECTS.get(key) : BODIES.get(key);
        if (kind == null) {
            return Optional.empty();
        }
        return overrides.of(kind, languageOf(locale))
                .filter(text -> {
                    boolean acceptable = MessageTemplateCatalog.check(kind, text).isEmpty();
                    if (!acceptable) {
                        log.warn("The club's {} wording of {} fails its check, so the shipped one is sent",
                                languageOf(locale), kind);
                    }
                    return acceptable;
                })
                .map(text -> SUBJECTS.containsKey(key) ? text.subject() : text.body());
    }

    private static String fillOrNull(String key, String template, Map<String, String> values) {
        try {
            return fill(key, template, values);
        } catch (IllegalStateException unfillable) {
            log.warn("The club's wording of {} cannot be filled, so the shipped one is sent", key);
            return null;
        }
    }

    static String languageOf(Locale locale) {
        return "de".equals(locale.getLanguage()) ? "de" : "en";
    }

    static String shipped(String key, Locale locale) {
        return bundle(locale).getString(key);
    }

    // One pass over the template, so a value that happens to read like a placeholder stays a value.
    static String fill(String key, String template, Map<String, String> values) {
        String withoutEmptyLink = "".equals(values.get(InstanceLinks.PLACEHOLDER))
                ? EMPTY_LINK_LINE.matcher(template).replaceAll("")
                : template;
        return PLACEHOLDER.matcher(withoutEmptyLink).replaceAll(match -> {
            String name = match.group(1);
            String value = values.get(name);
            if (value == null) {
                throw new IllegalStateException("The mail template " + key + " names " + name
                        + ", which the message does not provide");
            }
            return Matcher.quoteReplacement(value);
        });
    }

    private static Map<String, MessageKind> byKey(String part) {
        return Arrays.stream(MessageKind.values())
                .collect(Collectors.toUnmodifiableMap(kind -> kind.templateKey() + part, Function.identity()));
    }

    private static ResourceBundle bundle(Locale locale) {
        try {
            return ResourceBundle.getBundle(BUNDLE, locale, SHIPPED_LANGUAGE_ONLY);
        } catch (MissingResourceException e) {
            throw new IllegalStateException("The mail templates are missing from the image", e);
        }
    }
}
