package org.courtside.member;

import lombok.Getter;

import java.util.Map;

@Getter
public class MembershipTypeRuleSetInactiveException extends RuntimeException {

    private final String code;
    private final Map<String, Object> params;

    MembershipTypeRuleSetInactiveException(String code, Map<String, Object> params) {
        super(code);
        this.code = code;
        this.params = Map.copyOf(params);
    }
}
