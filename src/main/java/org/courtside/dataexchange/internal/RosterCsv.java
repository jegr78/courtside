package org.courtside.dataexchange.internal;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;

import java.io.IOException;
import java.io.StringWriter;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

public final class RosterCsv {

    private static final byte[] UTF_8_MARK = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    private static final String[] HEADER = {"memberNumber", "firstName", "lastName", "email",
            "membershipType", "membershipStartedOn", "membershipEndedOn"};

    public record Row(String memberNumber, String firstName, String lastName, String email,
                      String membershipType, LocalDate membershipStartedOn,
                      LocalDate membershipEndedOn) {
    }

    private RosterCsv() {
    }

    public static byte[] write(List<Row> rows, char separator, Charset charset) {
        StringWriter text = new StringWriter();
        try (CSVPrinter printer = format(separator).print(text)) {
            for (Row row : rows) {
                printer.printRecord(cell(row.memberNumber()), cell(row.firstName()),
                        cell(row.lastName()), cell(row.email()), cell(row.membershipType()),
                        date(row.membershipStartedOn()), date(row.membershipEndedOn()));
            }
        } catch (IOException e) {
            throw new UncheckedIOException("A roster written into memory cannot fail on IO", e);
        }
        return encoded(text.toString(), charset);
    }

    // The same dialect the import parses, so a club that exports and re-imports is read by the
    // reader this file was written for.
    private static CSVFormat format(char separator) {
        return CSVFormat.DEFAULT.builder()
                .setDelimiter(separator)
                .setHeader(HEADER)
                .setRecordSeparator("\r\n")
                .get();
    }

    private static String cell(String value) {
        return value == null ? "" : value;
    }

    private static String date(LocalDate day) {
        return day == null ? "" : day.toString();
    }

    // A spreadsheet handed UTF-8 without a mark guesses the encoding, and guesses wrong on the
    // first name with an umlaut in it.
    private static byte[] encoded(String text, Charset charset) {
        ByteBuffer written = charset.encode(text);
        byte[] content = new byte[written.remaining()];
        written.get(content);
        if (!charset.equals(StandardCharsets.UTF_8)) {
            return content;
        }
        byte[] marked = new byte[UTF_8_MARK.length + content.length];
        System.arraycopy(UTF_8_MARK, 0, marked, 0, UTF_8_MARK.length);
        System.arraycopy(content, 0, marked, UTF_8_MARK.length, content.length);
        return marked;
    }
}
