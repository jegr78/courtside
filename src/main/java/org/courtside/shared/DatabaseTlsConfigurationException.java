package org.courtside.shared;

class DatabaseTlsConfigurationException extends RuntimeException {

    private final String action;

    DatabaseTlsConfigurationException(String message, String action) {
        super(message);
        this.action = action;
    }

    DatabaseTlsConfigurationException(String message, String action, Throwable cause) {
        super(message, cause);
        this.action = action;
    }

    String action() {
        return action;
    }
}
