package org.courtside.facility;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class AccessPointRejectedException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "access-point-rejected", HttpStatus.BAD_REQUEST,
            "Access point rejected", "The name or an access code of an access point cannot be stored");

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

    static AccessPointRejectedException codeNotDigits(String field) {
        return new AccessPointRejectedException("facility.accessPoint.codeNotDigits", Map.of("field", field));
    }

    static AccessPointRejectedException codeLength(String field, int digits) {
        return new AccessPointRejectedException("facility.accessPoint.codeLength",
                Map.of("field", field, "digits", digits));
    }

    static AccessPointRejectedException emergencyCodeNeedsDynamicCodes() {
        return new AccessPointRejectedException("facility.accessPoint.emergencyCodeNeedsDynamicCodes",
                Map.of("field", "emergencyCode"));
    }

    static AccessPointRejectedException emergencyCodeCollides(String field) {
        return new AccessPointRejectedException("facility.accessPoint.emergencyCodeCollides", Map.of("field", field));
    }

    static AccessPointRejectedException codeIssued(String field) {
        return new AccessPointRejectedException("facility.accessPoint.codeIssued", Map.of("field", field));
    }

    static AccessPointRejectedException loxoneGroupMalformed() {
        return new AccessPointRejectedException("facility.accessPoint.loxoneGroupMalformed",
                Map.of("field", "loxoneGroup"));
    }

    static AccessPointRejectedException openToMembersNeedsCode() {
        return new AccessPointRejectedException("facility.accessPoint.openToMembersNeedsCode",
                Map.of("field", "openToMembers"));
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
