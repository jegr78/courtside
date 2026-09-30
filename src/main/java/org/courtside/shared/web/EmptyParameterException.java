package org.courtside.shared.web;

import lombok.Getter;

@Getter
class EmptyParameterException extends RuntimeException {

    private final String parameterName;

    EmptyParameterException(String parameterName) {
        super("The request parameter " + parameterName + " has an empty value");
        this.parameterName = parameterName;
    }
}
