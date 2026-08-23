package org.courtside.shared.internal;

import org.courtside.shared.SupportedLanguages;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.ResourcePatternResolver;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Collections;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
class ShippedLanguages implements SupportedLanguages {

    // The bundle without a suffix is the fallback ResourceBundle resolves to, so its language is the
    // one no file name names.
    private static final String BASE_LANGUAGE = "en";

    private static final String SCREEN_BUNDLES = "classpath*:messages_*.properties";
    private static final String MAIL_BUNDLES = "classpath*:mail_*.properties";
    private static final Pattern TRANSLATED =
            Pattern.compile("^[a-z]+_([a-zA-Z]{2,3}(?:_[a-zA-Z0-9]{2,8})*)\\.properties$");

    private final Set<String> tags;

    ShippedLanguages(ResourcePatternResolver resources) {
        Set<String> screen = languagesIn(resources, SCREEN_BUNDLES);
        Set<String> mail = languagesIn(resources, MAIL_BUNDLES);
        if (!screen.equals(mail)) {
            throw new IllegalStateException("A language is translated for one surface but not the "
                    + "other, so a member would be written to in a language they did not choose: "
                    + "messages " + screen + " against mail " + mail);
        }
        screen.add(BASE_LANGUAGE);
        this.tags = Collections.unmodifiableSet(screen);
    }

    @Override
    public Set<String> tags() {
        return tags;
    }

    @Override
    public boolean supports(String tag) {
        return tag != null && !tag.isBlank() && tags.contains(tag);
    }

    private static Set<String> languagesIn(ResourcePatternResolver resources, String pattern) {
        Set<String> found = new TreeSet<>();
        for (Resource resource : resolved(resources, pattern)) {
            Matcher matched = TRANSLATED.matcher(String.valueOf(resource.getFilename()));
            if (matched.matches()) {
                found.add(matched.group(1).replace('_', '-'));
            }
        }
        return found;
    }

    private static Resource[] resolved(ResourcePatternResolver resources, String pattern) {
        try {
            return resources.getResources(pattern);
        } catch (IOException e) {
            throw new IllegalStateException("The message bundles cannot be read from the image", e);
        }
    }
}
