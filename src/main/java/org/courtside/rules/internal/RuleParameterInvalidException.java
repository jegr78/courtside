package org.courtside.rules.internal;

import lombok.Getter;

import java.util.Map;

@Getter
public class RuleParameterInvalidException extends RuntimeException {

    private final String code;
    private final Map<String, Object> params;

    RuleParameterInvalidException(String code, Map<String, Object> params) {
        super(code);
        this.code = code;
        this.params = Map.copyOf(params);
    }
}
