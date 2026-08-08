package org.courtside.shared;

import org.springframework.http.HttpStatus;

import java.net.URI;
import java.util.regex.Pattern;

public record ProblemType(String slug, HttpStatus status, String title, String detail) {

    private static final String URN_PREFIX = "urn:courtside:error:";
    private static final Pattern SLUG = Pattern.compile("[a-z0-9]+(-[a-z0-9]+)*");

    public ProblemType {
        if (slug == null || !SLUG.matcher(slug).matches()) {
            throw new IllegalArgumentException(
                    "A problem type slug must be kebab-case, was: " + slug);
        }
        if (status == null || !status.isError()) {
            throw new IllegalArgumentException(
                    "A problem type must carry a 4xx or 5xx status, was: " + status);
        }
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("A problem type needs a title");
        }
        if (detail == null || detail.isBlank()) {
            throw new IllegalArgumentException("A problem type needs a detail");
        }
    }

    public URI uri() {
        return URI.create(URN_PREFIX + slug);
    }
}
