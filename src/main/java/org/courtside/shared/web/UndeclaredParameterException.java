package org.courtside.shared.web;

import lombok.Getter;

@Getter
class UndeclaredParameterException extends RuntimeException {

    private final String parameterName;

    UndeclaredParameterException(String parameterName) {
        super("The request states a parameter its operation does not declare");
        this.parameterName = parameterName;
    }
}
