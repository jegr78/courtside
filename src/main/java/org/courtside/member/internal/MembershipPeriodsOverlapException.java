package org.courtside.member.internal;

import lombok.Getter;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.Map;

@Getter
public class MembershipPeriodsOverlapException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "membership-periods-overlap", HttpStatus.CONFLICT,
            "Membership periods overlap", "A person holds one membership on any given day");

    private final String code = "membershipPeriod.overlaps";

    public MembershipPeriodsOverlapException(String message) {
        super(message);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    protected Map<String, Object> properties() {
        return Map.of("violations", oneViolation(code, Map.of()));
    }
}
