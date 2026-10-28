package org.courtside.identity;

import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;

import java.util.Arrays;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

public interface AccountSecurityMaintenance {
    void execute(Command command);

    static boolean requested(String[] args) {
        return Arrays.stream(args).anyMatch(arg -> arg.startsWith("--courtside.maintenance.action="));
    }

    static void runApplication(Class<?> source, String[] args) {
        Command command = command(args);
        SpringApplication application = new SpringApplication(source);
        application.addInitializers(context -> context.getEnvironment().getPropertySources().addFirst(
                new MapPropertySource("accountSecurityMaintenance", Map.of(
                        "server.address", "127.0.0.1", "server.port", "0",
                        "management.server.address", "127.0.0.1", "management.server.port", "0"))));
        try (var context = application.run(args)) {
            context.getBean(AccountSecurityMaintenance.class).execute(command);
        }
    }

    static Command command(String[] args) {
        String action = value(args, "action");
        if ("mfa-rotate-keys".equals(action)) return new Command(action, null, null, false);
        if (!"mfa-recover".equals(action) && !"mfa-correct-email".equals(action)) {
            throw new IllegalStateException("Unknown account-security maintenance action");
        }
        if (!"true".equals(value(args, "identity-checked"))) {
            throw new IllegalStateException("Account recovery requires --courtside.maintenance.identity-checked=true");
        }
        UUID account;
        try {
            account = UUID.fromString(value(args, "account-id"));
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw new IllegalStateException("Account recovery requires a valid --courtside.maintenance.account-id");
        }
        String emailFile = value(args, "email-file");
        if ("mfa-correct-email".equals(action) && (emailFile == null || emailFile.isBlank())) {
            throw new IllegalStateException("Email correction requires --courtside.maintenance.email-file");
        }
        try {
            return new Command(action, account, emailFile == null ? null : Path.of(emailFile), true);
        } catch (java.nio.file.InvalidPathException invalid) {
            throw new IllegalStateException("Maintenance email-file must name an absolute private file");
        }
    }

    private static String value(String[] args, String name) {
        String prefix = "--courtside.maintenance." + name + "=";
        var values = Arrays.stream(args).filter(arg -> arg.startsWith(prefix)).map(arg -> arg.substring(prefix.length())).toList();
        if (values.size() > 1) throw new IllegalStateException("A maintenance argument may be supplied only once");
        return values.isEmpty() ? null : values.getFirst();
    }

    record Command(String action, UUID account, Path emailFile, boolean identityChecked) { }
}
