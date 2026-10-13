package org.courtside.booking.partner;

import org.courtside.shared.CodedDomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

public class PartnerPlaceUnavailableException extends CodedDomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "partner-place-unavailable", HttpStatus.CONFLICT,
            "No place to offer", "This booking has no place a partner could take");

    private PartnerPlaceUnavailableException(String code) {
        super(code, Map.of());
    }

    static PartnerPlaceUnavailableException none() {
        return new PartnerPlaceUnavailableException("partner.place.none");
    }

    static PartnerPlaceUnavailableException closed() {
        return new PartnerPlaceUnavailableException("partner.place.closed");
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }
}
