package org.courtside.shared;

class DatabaseIdentityConfigurationException extends RuntimeException {

    private final String action;

    DatabaseIdentityConfigurationException(String message, String action) {
        super(message);
        this.action = action;
    }

    DatabaseIdentityConfigurationException(String message, String action, Throwable cause) {
        super(message, cause);
        this.action = action;
    }

    String action() {
        return action;
    }

    @Override
    public String getLocalizedMessage() {
        return getMessage() + System.lineSeparator() + "Action: " + action;
    }
}
