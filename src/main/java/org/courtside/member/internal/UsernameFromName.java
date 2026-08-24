package org.courtside.member.internal;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Map;

public final class UsernameFromName {

    private static final int MINIMUM = 3;
    private static final int ROOM_FOR_A_NUMBER = 55;
    private static final String FALLBACK = "member";
    // German writes an umlaut out where the neutral rule would drop it; a Scandinavian club is not
    // served by the same substitution, so it follows the language the club runs in.
    private static final Map<Character, String> GERMAN =
            Map.of('ä', "ae", 'ö', "oe", 'ü', "ue", 'ß', "ss");

    private UsernameFromName() {
    }

    // Never empty: a name that carries nothing a login name can hold falls back to the number the
    // club's own system calls this person by, and a board renames it afterwards like any other.
    public static String suggestFor(String firstName, String lastName, String externalId,
                                    Locale locale) {
        String fromName = trimmed(simplify(lastName, locale) + "." + simplify(firstName, locale));
        if (usable(fromName)) {
            return capped(fromName);
        }
        return capped(trimmed(FALLBACK + "." + simplify(externalId, locale)));
    }

    private static boolean usable(String candidate) {
        return candidate.length() >= MINIMUM && candidate.matches("^[a-z0-9._-]+$");
    }

    private static String capped(String candidate) {
        return candidate.substring(0, Math.min(candidate.length(), ROOM_FOR_A_NUMBER));
    }

    private static String trimmed(String candidate) {
        return candidate.replaceAll("^[.-]+|[.-]+$", "");
    }

    private static String simplify(String name, Locale locale) {
        String lowercase = name == null ? "" : name.toLowerCase(Locale.ROOT);
        StringBuilder written = new StringBuilder();
        lowercase.chars().forEach(character -> written.append(spellOut((char) character, locale)));
        return Normalizer.normalize(written, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .replaceAll("[^a-z0-9.-]", "");
    }

    private static String spellOut(char character, Locale locale) {
        return "de".equals(locale.getLanguage())
                ? GERMAN.getOrDefault(character, String.valueOf(character))
                : String.valueOf(character);
    }
}
