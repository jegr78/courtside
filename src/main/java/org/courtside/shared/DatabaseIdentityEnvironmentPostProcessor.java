package org.courtside.shared;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.postgresql.Driver;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

public class DatabaseIdentityEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    private static final String MODE = "courtside.database.identity.mode";
    private static final String USERNAME = "courtside.database.identity.runtime-username";
    private static final String PASSWORD_FILE = "courtside.database.identity.runtime-password-file";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String configuredMode = environment.getProperty(MODE, "shared");
        if (!"separate".equals(configuredMode.toLowerCase(Locale.ROOT))) {
            if (!"shared".equals(configuredMode.toLowerCase(Locale.ROOT))) {
                throw new DatabaseIdentityConfigurationException(MODE + " is '" + configuredMode
                        + "', not shared or separate.",
                        "Choose shared for the standard deployment or separate for file-backed runtime access.");
            }
            if (hasValue(environment, USERNAME) || hasValue(environment, PASSWORD_FILE)) {
                throw new DatabaseIdentityConfigurationException(
                        "A separate runtime identity input is set while " + MODE + " is shared.",
                        "Set " + MODE + " to separate, or remove the unused runtime identity inputs.");
            }
            return;
        }
        refuseDirectCredential(environment, "spring.datasource.username");
        refuseDirectCredential(environment, "spring.datasource.password");
        refuseDirectCredential(environment, "spring.datasource.hikari.username");
        refuseDirectCredential(environment, "spring.datasource.hikari.password");
        refuseDirectCredential(environment, "spring.datasource.hikari.data-source-properties.user");
        refuseDirectCredential(environment, "spring.datasource.hikari.data-source-properties.password");
        refuseDirectCredential(environment, "spring.datasource.hikari.data-source-properties.service");
        refuseDirectCredential(environment, "spring.flyway.user");
        refuseDirectCredential(environment, "spring.flyway.password");
        refuseUrlCredential(environment.getProperty("spring.datasource.url"));
        String username = environment.getProperty(USERNAME);
        if (username == null || username.isBlank()) {
            throw new DatabaseIdentityConfigurationException(USERNAME + " names no database role.",
                    "Set it to the dedicated runtime role created for this instance.");
        }
        String password = DatabaseSecretFile.read(PASSWORD_FILE, environment.getProperty(PASSWORD_FILE));
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("spring.datasource.username", username);
        values.put("spring.datasource.password", password);
        values.put("spring.flyway.enabled", "false");
        values.put("spring.session.jdbc.initialize-schema", "never");
        environment.getPropertySources().addFirst(new MapPropertySource("courtsideDatabaseIdentity", values));
    }

    private static void refuseDirectCredential(ConfigurableEnvironment environment, String property) {
        if (environment.containsProperty(property)) {
            throw new DatabaseIdentityConfigurationException(property
                    + " is set while the separate database identity is enabled.",
                    "Remove the direct value so only the mounted runtime secret can configure the application.");
        }
    }

    private static boolean hasValue(ConfigurableEnvironment environment, String property) {
        String value = environment.getProperty(property);
        return value != null && !value.isBlank();
    }

    static void refuseUrlCredential(String url) {
        if (url == null) {
            return;
        }
        Properties parsed = Driver.parseURL(url, null);
        if (parsed == null) {
            return;
        }
        for (String property : new String[]{"user", "password", "service"}) {
            if (parsed.containsKey(property)) {
                throw new DatabaseIdentityConfigurationException(
                        "The database connection URL carries '" + property
                                + "', which overrides the separate runtime identity.",
                        "Remove it so only the mounted runtime secret configures the application.");
            }
        }
    }

    @Override
    public int getOrder() {
        return ConfigDataEnvironmentPostProcessor.ORDER + 2;
    }
}
