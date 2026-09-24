package org.courtside.shared.internal;

import org.courtside.shared.SupportedLanguages;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.ResourcePatternResolver;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
class ShippedLanguages implements SupportedLanguages {

    // The bundle without a suffix is the fallback ResourceBundle resolves to, so its language is the
    // one no file name names.
    private static final String BASE_LANGUAGE = "en";

    private static final List<String> FAMILIES = List.of("messages", "mail", "seed", "manifest");
    private static final Pattern TRANSLATED =
            Pattern.compile("^[a-z]+_([a-zA-Z]{2,3}(?:_[a-zA-Z0-9]{2,8})*)\\.properties$");

    private final Set<String> tags;

    ShippedLanguages(ResourcePatternResolver resources) {
        Map<String, Set<String>> byFamily = new LinkedHashMap<>();
        for (String family : FAMILIES) {
            byFamily.put(family, languagesIn(resources, "classpath*:" + family + "_*.properties"));
        }
        if (new HashSet<>(byFamily.values()).size() > 1) {
            throw new IllegalStateException("A language is translated for one surface but not for "
                    + "every other, so a club would read one of them in a language it did not "
                    + "choose: " + byFamily);
        }
        Set<String> offered = new TreeSet<>(byFamily.get(FAMILIES.getFirst()));
        offered.add(BASE_LANGUAGE);
        this.tags = Collections.unmodifiableSet(offered);
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
