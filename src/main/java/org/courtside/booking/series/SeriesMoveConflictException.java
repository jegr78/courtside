package org.courtside.booking.series;

import lombok.Getter;
import org.courtside.shared.DomainFailure;
import org.courtside.shared.ProblemType;
import org.springframework.http.HttpStatus;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Getter
public class SeriesMoveConflictException extends DomainFailure {

    public static final ProblemType PROBLEM_TYPE = new ProblemType(
            "series-move-conflict", HttpStatus.CONFLICT,
            "Move not possible", "Some occurrences cannot move to the requested slot");

    private static final String CODE = "booking.series.moveConflict";

    private final List<UUID> blockedBookingIds;

    public SeriesMoveConflictException(List<UUID> blockedBookingIds) {
        super("%d occurrences cannot move".formatted(blockedBookingIds.size()));
        this.blockedBookingIds = List.copyOf(blockedBookingIds);
    }

    @Override
    public ProblemType problemType() {
        return PROBLEM_TYPE;
    }

    @Override
    protected Map<String, Object> properties() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("blockedBookingIds", blockedBookingIds);
        properties.put("code", CODE);
        return properties;
    }
}
