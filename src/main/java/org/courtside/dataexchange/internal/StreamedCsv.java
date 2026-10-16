package org.courtside.dataexchange.internal;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVPrinter;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.Supplier;

public final class StreamedCsv extends InputStream {

    private static final byte[] UTF_8_MARK = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};

    private final List<String> header;
    private final Supplier<List<List<String>>> nextRows;
    private final ByteArrayOutputStream encoded = new ByteArrayOutputStream();
    private final Writer writer;
    private final CSVPrinter printer;
    private byte[] pending = new byte[0];
    private int position;
    private boolean started;
    private boolean finished;

    // Rows are asked for one batch at a time as the reader drains the bytes, so a file of any
    // length passes through without being held whole. An empty batch ends the file.
    public StreamedCsv(List<String> header, Supplier<List<List<String>>> nextRows, char separator,
                       Charset charset) {
        this.header = List.copyOf(header);
        this.nextRows = nextRows;
        if (charset.equals(StandardCharsets.UTF_8)) {
            encoded.writeBytes(UTF_8_MARK);
        }
        this.writer = new OutputStreamWriter(encoded, charset);
        try {
            this.printer = CSVFormat.DEFAULT.builder()
                    .setDelimiter(separator)
                    .setRecordSeparator("\r\n")
                    .get()
                    .print(writer);
        } catch (IOException e) {
            throw new UncheckedIOException("A writer into memory cannot fail on IO", e);
        }
    }

    @Override
    public int read() throws IOException {
        if (!hasBytes()) {
            return -1;
        }
        return pending[position++] & 0xFF;
    }

    @Override
    public int read(byte[] target, int offset, int length) throws IOException {
        if (length == 0) {
            return 0;
        }
        if (!hasBytes()) {
            return -1;
        }
        int copied = Math.min(length, pending.length - position);
        System.arraycopy(pending, position, target, offset, copied);
        position += copied;
        return copied;
    }

    private boolean hasBytes() throws IOException {
        while (position >= pending.length) {
            if (finished) {
                return false;
            }
            refill();
        }
        return true;
    }

    private void refill() throws IOException {
        if (!started) {
            started = true;
            printer.printRecord(header);
        } else {
            List<List<String>> rows = nextRows.get();
            if (rows.isEmpty()) {
                finished = true;
            } else {
                for (List<String> row : rows) {
                    printer.printRecord(row.stream().map(ExportCsv::cell).toList());
                }
            }
        }
        printer.flush();
        writer.flush();
        pending = encoded.toByteArray();
        encoded.reset();
        position = 0;
    }
}
