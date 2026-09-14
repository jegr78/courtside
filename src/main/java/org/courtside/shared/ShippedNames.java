package org.courtside.shared;

import java.util.Set;

// What the rows an instance is shipped with are called, so a club reads them in its own language.
public interface ShippedNames {

    String in(String key, String languageTag);

    Set<String> everyLanguage(String key);
}
