package org.courtside.shared;

import java.util.Set;

// What the rows an instance is shipped with are called, so a club reads them in its own language.
public interface ShippedNames {

    String in(String key, String languageTag);

    Set<String> everyLanguage(String key);

    // A club that renamed a row chose that name, and a name no language of this image gives the row
    // is such a choice - which is what keeps a club's own wording out of the reach of its language.
    default boolean isStillTheShippedName(String key, String name) {
        return everyLanguage(key).contains(name);
    }
}
