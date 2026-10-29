package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccessPointRejectedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "access-point-rejected", HttpStatus.BAD_REQUEST,
            "Access point rejected", "The name or the static access code of an access point cannot be stored");

    private AccessPointRejectedException(String code, Map<String, Object> params) {
        super(code, params);
    }

    static AccessPointRejectedException nameRequired() {
        return new AccessPointRejectedException("facility.accessPoint.nameRequired", Map.of("field", "name"));
    }

    static AccessPointRejectedException nameTooLong(int maximum) {
        return new AccessPointRejectedException("facility.accessPoint.nameTooLong",
                Map.of("field", "name", "maximum", maximum));
    }

    static AccessPointRejectedException codeNotDigits() {
        return new AccessPointRejectedException("facility.accessPoint.codeNotDigits", Map.of("field", "staticCode"));
    }

    static AccessPointRejectedException codeLength(int digits) {
        return new AccessPointRejectedException("facility.accessPoint.codeLength",
                Map.of("field", "staticCode", "digits", digits));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
