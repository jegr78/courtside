package org.courtside.shared;

import java.util.Set;

public interface SupportedLanguages {

    Set<String> tags();

    boolean supports(String tag);

    default void require(String tag) {
        if (!supports(tag)) {
            throw new UnsupportedLanguageException(tag, tags());
        }
    }
}
