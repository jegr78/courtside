package org.courtside.notification.internal;

import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Map;
import java.util.MissingResourceException;
import java.util.ResourceBundle;

// Plain text, and the placeholders are named rather than positional: a translator moving a value
// inside a sentence must not have to count arguments to keep it correct.
@Component
class MailTemplates {

    private static final String BUNDLE = "mail";

    String render(String key, Locale locale, Map<String, String> values) {
        String template = bundle(locale).getString(key);
        String rendered = template;
        for (Map.Entry<String, String> value : values.entrySet()) {
            rendered = rendered.replace("{" + value.getKey() + "}", value.getValue());
        }
        return rendered;
    }

    private static ResourceBundle bundle(Locale locale) {
        try {
            return ResourceBundle.getBundle(BUNDLE, locale);
        } catch (MissingResourceException e) {
            throw new IllegalStateException("The mail templates are missing from the image", e);
        }
    }
}
