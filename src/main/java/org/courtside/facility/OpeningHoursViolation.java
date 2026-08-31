package org.courtside.facility;

import java.time.DayOfWeek;
import java.util.LinkedHashMap;
import java.util.Map;

public record OpeningHoursViolation(String code, Map<String, Object> params) {

    public OpeningHoursViolation {
        params = params == null ? Map.of() : Map.copyOf(params);
    }

    public static OpeningHoursViolation on(DayOfWeek day, String code, Map<String, Object> params) {
        Map<String, Object> named = new LinkedHashMap<>(params == null ? Map.of() : params);
        named.put("day", day.name());
        return new OpeningHoursViolation(code, named);
    }
}
