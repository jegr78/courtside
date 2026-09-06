package org.courtside.dataexchange.internal;

import java.nio.charset.Charset;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;

public final class RosterCsv {

    private static final List<String> HEADER = List.of("memberNumber", "firstName", "lastName",
            "email", "membershipType", "membershipStartedOn", "membershipEndedOn");

    public record Row(String memberNumber, String firstName, String lastName, String email,
                      String membershipType, LocalDate membershipStartedOn,
                      LocalDate membershipEndedOn) {
    }

    private RosterCsv() {
    }

    public static byte[] write(List<Row> rows, char separator, Charset charset) {
        return ExportCsv.write(HEADER, rows.stream().map(RosterCsv::cells).toList(), separator,
                charset);
    }

    private static List<String> cells(Row row) {
        return Arrays.asList(row.memberNumber(), row.firstName(), row.lastName(), row.email(),
                row.membershipType(), date(row.membershipStartedOn()), date(row.membershipEndedOn()));
    }

    private static String date(LocalDate day) {
        return day == null ? null : day.toString();
    }
}
