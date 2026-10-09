package org.courtside.booking.internal;

import lombok.RequiredArgsConstructor;
import org.courtside.facility.FacilityService;
import org.courtside.shared.WarmUpReads;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@Order(20)
@RequiredArgsConstructor
class CourtPlanWarmUpReads implements WarmUpReads {

    private final FacilityService facility;

    @Override
    public String name() {
        return "court-plan";
    }

    @Override
    public List<String> paths() {
        return List.of("/api/bookings?date=" + facility.today());
    }
}
