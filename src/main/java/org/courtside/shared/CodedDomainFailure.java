package org.courtside.shared;

import lombok.Getter;

import java.util.LinkedHashMap;
import java.util.Map;

@Getter
public abstract class CodedDomainFailure extends DomainFailure {

    private final String code;
    private final Map<String, Object> params;

    protected CodedDomainFailure(String code, Map<String, Object> params) {
        this(code, params, null);
    }

    protected CodedDomainFailure(String code, Map<String, Object> params, Throwable cause) {
        super(code, cause);
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("A coded failure needs an i18n code");
        }
        this.code = code;
        this.params = params == null ? Map.of() : Map.copyOf(params);
    }

    @Override
    protected Map<String, Object> properties() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("code", code);
        properties.put("params", params);
        return properties;
    }
}
