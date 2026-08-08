package org.courtside.booking.internal;

import lombok.Getter;

import java.util.Map;

@Getter
public class ParticipantsInvalidException extends RuntimeException {

    private final String code;
    private final Map<String, Object> params;

    public ParticipantsInvalidException(String code, Map<String, Object> params) {
        super(code);
        this.code = code;
        this.params = Map.copyOf(params);
    }
}
