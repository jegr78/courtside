package org.courtside.shared;

import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;
import java.util.Set;

public class UnsupportedLanguageException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "language-unsupported", HttpStatus.BAD_REQUEST,
            "Language not shipped",
            "This instance can only write in the languages it carries translations for");

    UnsupportedLanguageException(String tag, Set<String> supported) {
        super("language.unsupported", Map.of(
                "locale", tag == null ? "" : tag,
                "supported", List.copyOf(supported)));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
