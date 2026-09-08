package org.courtside.shared;

import com.zaxxer.hikari.HikariDataSource;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;
import java.util.regex.Pattern;

public final class DatabaseProvisioning {

    private static final String COMMAND = "--courtside-database-setup";
    private static final Pattern ROLE_NAME = Pattern.compile("[a-z][a-z0-9_]{0,62}");
    private static final String OWNER_PASSWORD_FILE = "COURTSIDE_DB_OWNER_PASSWORD_FILE";
    private static final String MIGRATION_PASSWORD_FILE = "COURTSIDE_DB_MIGRATION_PASSWORD_FILE";
    private static final String RUNTIME_PASSWORD_FILE = "COURTSIDE_DB_RUNTIME_PASSWORD_FILE";

    private DatabaseProvisioning() {
    }

    public static boolean requested(String[] arguments) {
        return arguments.length == 1 && COMMAND.equals(arguments[0]);
    }

    public static void provision(Map<String, String> environment) {
        String url = required(environment, "SPRING_DATASOURCE_URL");
        DatabaseIdentityEnvironmentPostProcessor.refuseUrlCredential(url);
        String owner = role(environment, "COURTSIDE_DB_OWNER_USERNAME");
        String migration = boundedRole(environment, "COURTSIDE_DB_MIGRATION_USERNAME");
        String runtime = boundedRole(environment, "COURTSIDE_DB_RUNTIME_USERNAME");
        if (owner.equals(migration) || owner.equals(runtime) || migration.equals(runtime)) {
            throw new DatabaseIdentityConfigurationException(
                    "The owner, migration, and runtime database roles are not distinct.",
                    "Configure three different role names so no application process receives setup authority.");
        }
        String ownerPassword = DatabaseSecretFile.read(OWNER_PASSWORD_FILE,
                environment.get(OWNER_PASSWORD_FILE));
        String migrationPassword = DatabaseSecretFile.read(MIGRATION_PASSWORD_FILE,
                environment.get(MIGRATION_PASSWORD_FILE));
        String runtimePassword = DatabaseSecretFile.read(RUNTIME_PASSWORD_FILE,
                environment.get(RUNTIME_PASSWORD_FILE));

        try (HikariDataSource dataSource = new HikariDataSource()) {
            dataSource.setJdbcUrl(url);
            dataSource.setUsername(owner);
            dataSource.setPassword(ownerPassword);
            DatabaseTls.apply(dataSource, DatabaseMigration.tls(environment));
            try (Connection connection = dataSource.getConnection()) {
                connection.setAutoCommit(false);
                configure(connection, migration, migrationPassword, runtime, runtimePassword);
                connection.commit();
            } catch (SQLException failure) {
                if (hasSqlState(failure, "28P01")) {
                    throw new DatabaseIdentityConfigurationException(
                            "The setup credential was refused by PostgreSQL.",
                            "Replace " + OWNER_PASSWORD_FILE
                                    + " with the current credential for the configured owner role.", failure);
                }
                throw new DatabaseIdentityConfigurationException(
                        "The separate database identities could not be provisioned.",
                        "Run the setup process with the database owner and inspect its PostgreSQL diagnosis.",
                        failure);
            }
        }
    }

    private static void configure(Connection connection, String migration, String migrationPassword,
            String runtime, String runtimePassword) throws SQLException {
        ensureRole(connection, migration, migrationPassword);
        ensureRole(connection, runtime, runtimePassword);
        removeMemberships(connection, migration);
        removeMemberships(connection, runtime);
        executeFormatted(connection,
                "ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L",
                migration, migrationPassword);
        executeFormatted(connection,
                "ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD %L",
                runtime, runtimePassword);
        executeFormatted(connection, "REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC",
                connection.getCatalog());
        executeFormatted(connection, "GRANT CONNECT ON DATABASE %I TO %I",
                connection.getCatalog(), migration);
        executeFormatted(connection, "GRANT CONNECT ON DATABASE %I TO %I",
                connection.getCatalog(), runtime);
        execute(connection, "REVOKE CREATE ON SCHEMA public FROM PUBLIC");
        // PostgreSQL restricts extension installation to the database owner. The setup process
        // owns that one privileged prerequisite so the recurring migration process does not.
        execute(connection, "CREATE EXTENSION IF NOT EXISTS btree_gist");
        transferPublicObjects(connection, migration);
        executeFormatted(connection, "ALTER SCHEMA public OWNER TO %I", migration);
        executeFormatted(connection, "REVOKE ALL ON SCHEMA public FROM %I", runtime);
        executeFormatted(connection, "GRANT USAGE ON SCHEMA public TO %I", runtime);
        executeFormatted(connection, "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I", runtime);
        executeFormatted(connection, "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I",
                runtime);
        executeFormatted(connection, "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I", runtime);
        executeFormatted(connection, "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO %I",
                runtime);
        executeFormatted(connection, "ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public "
                + "REVOKE ALL ON TABLES FROM %I", migration, runtime);
        executeFormatted(connection, "ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public "
                + "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I", migration, runtime);
        executeFormatted(connection, "ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public "
                + "REVOKE ALL ON SEQUENCES FROM %I", migration, runtime);
        executeFormatted(connection, "ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public "
                + "GRANT USAGE ON SEQUENCES TO %I", migration, runtime);
    }

    private static void ensureRole(Connection connection, String role, String password) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = ?)")) {
            statement.setString(1, role);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                if (!result.getBoolean(1)) {
                    executeFormatted(connection, "CREATE ROLE %I LOGIN PASSWORD %L", role, password);
                }
            }
        }
    }

    private static void removeMemberships(Connection connection, String role) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT format('REVOKE %I FROM %I', granted.rolname, member.rolname)
                  FROM pg_auth_members membership
                  JOIN pg_roles granted ON granted.oid = membership.roleid
                  JOIN pg_roles member ON member.oid = membership.member
                 WHERE member.rolname = ?
                """)) {
            statement.setString(1, role);
            executeEach(connection, statement);
        }
    }

    private static void transferPublicObjects(Connection connection, String migration) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT format('ALTER %s %I.%I OWNER TO %I',
                              CASE relation.relkind
                                WHEN 'S' THEN 'SEQUENCE'
                                WHEN 'v' THEN 'VIEW'
                                WHEN 'm' THEN 'MATERIALIZED VIEW'
                                WHEN 'f' THEN 'FOREIGN TABLE'
                                ELSE 'TABLE'
                              END,
                              namespace.nspname, relation.relname, ?)
                  FROM pg_class relation
                  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
                 WHERE namespace.nspname = 'public'
                   AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
                UNION ALL
                SELECT format('ALTER FUNCTION %s OWNER TO %I', procedure.oid::regprocedure, ?)
                  FROM pg_proc procedure
                  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
                 WHERE namespace.nspname = 'public'
                """)) {
            statement.setString(1, migration);
            statement.setString(2, migration);
            executeEach(connection, statement);
        }
    }

    private static void executeEach(Connection connection, PreparedStatement statements) throws SQLException {
        try (ResultSet result = statements.executeQuery(); Statement execution = connection.createStatement()) {
            while (result.next()) {
                execution.execute(result.getString(1));
            }
        }
    }

    private static void executeFormatted(Connection connection, String format, String... values)
            throws SQLException {
        String placeholders = String.join(", ", java.util.Collections.nCopies(values.length, "?"));
        try (PreparedStatement statement = connection.prepareStatement("SELECT format(?, " + placeholders + ")")) {
            statement.setString(1, format);
            for (int index = 0; index < values.length; index++) {
                statement.setString(index + 2, values[index]);
            }
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                execute(connection, result.getString(1));
            }
        }
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static String required(Map<String, String> environment, String key) {
        String value = environment.get(key);
        if (value == null || value.isBlank()) {
            throw new DatabaseIdentityConfigurationException(key + " is not configured.",
                    "Set every identity input before starting the setup process.");
        }
        return value;
    }

    private static String role(Map<String, String> environment, String key) {
        String value = required(environment, key);
        if (!ROLE_NAME.matcher(value).matches()) {
            throw new DatabaseIdentityConfigurationException(key + " is not a supported PostgreSQL role name.",
                    "Use a lower-case name beginning with a letter and containing only letters, digits, or '_'.");
        }
        return value;
    }

    private static String boundedRole(Map<String, String> environment, String key) {
        String value = role(environment, key);
        if (value.equals("postgres") || value.startsWith("pg_")) {
            throw new DatabaseIdentityConfigurationException(
                    key + " names a PostgreSQL reserved or administrative role.",
                    "Choose a dedicated role name that does not begin with 'pg_' and is not 'postgres'.");
        }
        return value;
    }

    private static boolean hasSqlState(Throwable failure, String expected) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SQLException sql && expected.equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }
}
