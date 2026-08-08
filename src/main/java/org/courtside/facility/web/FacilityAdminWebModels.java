package org.courtside.facility.web;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.UUID;

final class FacilityAdminWebModels {

    private FacilityAdminWebModels() {
    }

    record CourtResponse(UUID id, int number, String name, boolean active) {
    }

    record CourtRequest(
            @NotNull @Min(1) @Max(999) Integer number,
            @Size(max = 60) String name) {
    }

    record OpeningHoursResponse(DayOfWeek dayOfWeek, LocalTime opensAt, LocalTime closesAt) {
    }

    record SetOpeningHoursRequest(
            @NotNull LocalTime opensAt,
            @NotNull LocalTime closesAt) {
    }
}
