package org.courtside.shared;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component(DatabaseDeadlines.BEAN)
public class DatabaseDeadlines {

    static final String BEAN = "databaseDeadlines";

    public static final String REPORT = "#{@" + BEAN + ".reportSeconds()}";

    private final DatabaseDeadlineProperties properties;
    private final JdbcClient jdbc;

    DatabaseDeadlines(DatabaseDeadlineProperties properties, JdbcClient jdbc) {
        this.properties = properties;
        this.jdbc = jdbc;
    }

    public long reportSeconds() {
        return properties.reportTransactionTimeout().toSeconds();
    }

    // A sweep deletes whatever has accumulated, so one statement may legitimately outlast a request's.
    public void allowMaintenanceStatements() {
        jdbc.sql("SET LOCAL statement_timeout = " + properties.maintenanceStatementTimeout().toMillis()).update();
    }
}
