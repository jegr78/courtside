package org.courtside.member;

import lombok.Getter;

import java.util.Map;

@Getter
public class MembershipTypeRuleSetInvalidException extends RuntimeException {

    private final String code;
    private final Map<String, Object> params;

    MembershipTypeRuleSetInvalidException(String code, Map<String, Object> params, Throwable cause) {
        super(code, cause);
        this.code = code;
        this.params = Map.copyOf(params);
    }
}
