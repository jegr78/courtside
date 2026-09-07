package org.courtside.shared;

class DatabaseTlsMaterialException extends RuntimeException {

    DatabaseTlsMaterialException(String message) {
        super(message);
    }

    DatabaseTlsMaterialException(String message, Throwable cause) {
        super(message, cause);
    }
}
