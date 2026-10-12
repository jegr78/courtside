package org.courtside.notification.internal;

import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Map;
import java.util.MissingResourceException;
import java.util.ResourceBundle;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Plain text, and the placeholders are named rather than positional: a translator moving a value
// inside a sentence must not have to count arguments to keep it correct.
@Component
class MailTemplates {

    private static final String BUNDLE = "mail";
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([a-zA-Z]+)}");
    private static final ResourceBundle.Control SHIPPED_LANGUAGE_ONLY =
            ResourceBundle.Control.getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES);
    private static final String EMPTY_LINK = "[ \\t]*\\{" + InstanceLinks.PLACEHOLDER + "}[ \\t]*";
    private static final Pattern EMPTY_LINK_LINE =
            Pattern.compile("^" + EMPTY_LINK + "(?:\\R|$)|\\R" + EMPTY_LINK + "(?=\\R|$)");

    String render(String key, Locale locale, Map<String, String> values) {
        return fill(key, bundle(locale).getString(key), values);
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

    private static ResourceBundle bundle(Locale locale) {
        try {
            return ResourceBundle.getBundle(BUNDLE, locale, SHIPPED_LANGUAGE_ONLY);
        } catch (MissingResourceException e) {
            throw new IllegalStateException("The mail templates are missing from the image", e);
        }
    }
}
