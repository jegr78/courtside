package org.courtside.shared.testfixture;

import org.courtside.shared.SupportedLanguages;

import java.util.Set;
import java.util.TreeSet;

public record SupportedLanguagesFixture(Set<String> tags) implements SupportedLanguages {

    public static SupportedLanguages shipping(String... tags) {
        return new SupportedLanguagesFixture(new TreeSet<>(Set.of(tags)));
    }

    @Override
    public boolean supports(String tag) {
        return tag != null && tags.contains(tag);
    }
}
