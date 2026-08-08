package org.courtside.facility.internal;

import java.time.DayOfWeek;
import java.time.LocalTime;

public record WeeklyOpeningHours(DayOfWeek dayOfWeek, LocalTime opensAt, LocalTime closesAt) {
}
