package org.courtside.shared;

public interface ApplicationShellText {

    Text current();

    record Text(String language, String description) {
    }
}
