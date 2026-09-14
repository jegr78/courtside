package org.courtside.shared.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.shared.ShippedNames;
import org.courtside.shared.SupportedLanguages;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.MissingResourceException;
import java.util.ResourceBundle;
import java.util.Set;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
class ShippedSeedNames implements ShippedNames {

    private static final String BUNDLE = "seed";

    // Without this, a language the image does not ship resolves to the host's own default locale
    // rather than to the base bundle, so a club would be named in the language of its container.
    private static final ResourceBundle.Control NEVER_THE_HOST_LANGUAGE = ResourceBundle.Control
            .getNoFallbackControl(ResourceBundle.Control.FORMAT_PROPERTIES);

    private final SupportedLanguages languages;

    @Override
    public String in(String key, String languageTag) {
        if (languageTag == null || languageTag.isBlank()) {
            throw new IllegalStateException("A shipped row was named without a language: " + key);
        }
        return named(key, Locale.forLanguageTag(languageTag));
    }

    @Override
    public Set<String> everyLanguage(String key) {
        return languages.tags().stream()
                .map(tag -> in(key, tag))
                .collect(Collectors.toUnmodifiableSet());
    }

    private static String named(String key, Locale locale) {
        try {
            return ResourceBundle.getBundle(BUNDLE, locale, NEVER_THE_HOST_LANGUAGE).getString(key);
        } catch (MissingResourceException e) {
            throw new IllegalStateException("The shipped rows carry no name under " + key, e);
        }
    }
}
