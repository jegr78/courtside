package org.courtside.shared;

import lombok.Getter;

@Getter
public class InvalidOpeningWindowException extends RuntimeException {

    private final String code;

    InvalidOpeningWindowException(String code, String message) {
        super(message);
        this.code = code;
    }
}
