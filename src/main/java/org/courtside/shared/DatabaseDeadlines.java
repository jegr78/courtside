package org.courtside.shared;

import org.springframework.stereotype.Component;

@Component(DatabaseDeadlines.BEAN)
public class DatabaseDeadlines {

    static final String BEAN = "databaseDeadlines";

    public static final String REPORT = "#{@" + BEAN + ".reportSeconds()}";

    private final DatabaseDeadlineProperties properties;

    DatabaseDeadlines(DatabaseDeadlineProperties properties) {
        this.properties = properties;
    }

    public long reportSeconds() {
        return properties.reportTransactionTimeout().toSeconds();
    }
}
