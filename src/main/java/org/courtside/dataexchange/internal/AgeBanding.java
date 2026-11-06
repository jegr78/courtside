package org.courtside.dataexchange.internal;

import org.courtside.dataexchange.AgeBand;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Turns a birth date cell into the membership type of its band; the cell itself is never kept. */
public record AgeBanding(Map<String, List<AgeBand>> splits, int year) {

    public static final AgeBanding NONE = new AgeBanding(Map.of(), 0);

    private static final int OLDEST = 150;
    private static final Pattern DOTTED = Pattern.compile("^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})$");
    private static final Pattern ISO = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})$");
    private static final Pattern YEAR_ONLY = Pattern.compile("^(\\d{4})$");

    public AgeBanding {
        splits = Map.copyOf(splits);
    }

    public boolean splits(String category) {
        return category != null && splits.containsKey(category);
    }

    // Null when the cell names no plausible year, which leaves the category's own mapping in force.
    public UUID typeFor(String category, String birthDate) {
        Integer born = yearOf(birthDate);
        if (born == null || !splits(category)) {
            return null;
        }
        int age = year - born;
        if (age < 0 || age > OLDEST) {
            return null;
        }
        UUID type = null;
        for (AgeBand band : splits.get(category)) {
            if (band.fromAge() <= age) {
                type = band.membershipTypeId();
            }
        }
        return type;
    }

    private static Integer yearOf(String cell) {
        if (cell == null) {
            return null;
        }
        String text = cell.strip();
        Matcher dotted = DOTTED.matcher(text);
        if (dotted.matches()) {
            return validYear(Integer.parseInt(dotted.group(3)), Integer.parseInt(dotted.group(2)),
                    Integer.parseInt(dotted.group(1)));
        }
        Matcher iso = ISO.matcher(text);
        if (iso.matches()) {
            return validYear(Integer.parseInt(iso.group(1)), Integer.parseInt(iso.group(2)),
                    Integer.parseInt(iso.group(3)));
        }
        Matcher year = YEAR_ONLY.matcher(text);
        return year.matches() ? Integer.parseInt(year.group(1)) : null;
    }

    private static Integer validYear(int year, int month, int day) {
        try {
            return LocalDate.of(year, month, day).getYear();
        } catch (DateTimeException notADate) {
            return null;
        }
    }
}
