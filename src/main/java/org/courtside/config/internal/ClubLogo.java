package org.courtside.config.internal;

import javax.imageio.ImageIO;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;

public final class ClubLogo {

    private static final int MAX_BYTES = 1024 * 1024;
    private static final int MAX_DIMENSION = 2048;
    private static final byte[] PNG = {(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a};

    private final byte[] content;
    private final String mediaType;
    private final String digest;

    private ClubLogo(byte[] content, String mediaType, String digest) {
        this.content = content.clone();
        this.mediaType = mediaType;
        this.digest = digest;
    }

    public byte[] content() {
        return content.clone();
    }

    public String mediaType() {
        return mediaType;
    }

    public String digest() {
        return digest;
    }

    static ClubLogo parse(byte[] bytes) {
        if (bytes == null || bytes.length == 0) throw invalid("config.logo.empty");
        if (bytes.length > MAX_BYTES) throw invalid("config.logo.tooLarge");
        Image image = png(bytes);
        if (image == null) image = jpeg(bytes);
        if (image == null) throw invalid("config.logo.format");
        if (image.width() < 1 || image.height() < 1
                || image.width() > MAX_DIMENSION || image.height() > MAX_DIMENSION) {
            throw invalid("config.logo.dimensions");
        }
        byte[] normalized = normalize(bytes, image.mediaType());
        if (normalized.length > MAX_BYTES) throw invalid("config.logo.tooLarge");
        return new ClubLogo(normalized, image.mediaType(), sha256(normalized));
    }

    static ClubLogo stored(byte[] content, String mediaType, String digest) {
        if (content == null || content.length == 0 || content.length > MAX_BYTES) {
            throw new IllegalStateException("The stored club logo content is outside its size limit");
        }
        Image image = png(content);
        if (image == null) image = jpeg(content);
        if (image == null || !image.mediaType().equals(mediaType) || !sha256(content).equals(digest)) {
            throw new IllegalStateException("The stored club logo metadata does not match its content");
        }
        return new ClubLogo(content, mediaType, digest);
    }

    private static Image png(byte[] bytes) {
        if (bytes.length < 24 || !Arrays.equals(PNG, Arrays.copyOf(bytes, PNG.length))
                || bytes[12] != 'I' || bytes[13] != 'H' || bytes[14] != 'D' || bytes[15] != 'R') {
            return null;
        }
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        return new Image("image/png", buffer.getInt(16), buffer.getInt(20));
    }

    private static Image jpeg(byte[] bytes) {
        if (bytes.length < 4 || unsigned(bytes[0]) != 0xff || unsigned(bytes[1]) != 0xd8
                || unsigned(bytes[bytes.length - 2]) != 0xff || unsigned(bytes[bytes.length - 1]) != 0xd9) {
            return null;
        }
        int offset = 2;
        while (offset + 3 < bytes.length) {
            while (offset < bytes.length && unsigned(bytes[offset]) == 0xff) offset++;
            if (offset >= bytes.length) return null;
            int marker = unsigned(bytes[offset++]);
            if (marker == 0xd9 || marker == 0xda) return null;
            if (offset + 1 >= bytes.length) return null;
            int length = unsigned(bytes[offset]) << 8 | unsigned(bytes[offset + 1]);
            if (length < 2 || offset + length > bytes.length) return null;
            if (isStartOfFrame(marker) && length >= 7) {
                int height = unsigned(bytes[offset + 3]) << 8 | unsigned(bytes[offset + 4]);
                int width = unsigned(bytes[offset + 5]) << 8 | unsigned(bytes[offset + 6]);
                return new Image("image/jpeg", width, height);
            }
            offset += length;
        }
        return null;
    }

    private static boolean isStartOfFrame(int marker) {
        return marker >= 0xc0 && marker <= 0xcf
                && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;
    }

    private static int unsigned(byte value) {
        return Byte.toUnsignedInt(value);
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static byte[] normalize(byte[] bytes, String mediaType) {
        try {
            var image = ImageIO.read(new ByteArrayInputStream(bytes));
            if (image == null) throw invalid("config.logo.format");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            String format = mediaType.equals("image/png") ? "png" : "jpeg";
            if (!ImageIO.write(image, format, output)) throw invalid("config.logo.format");
            return output.toByteArray();
        } catch (IOException e) {
            throw invalid("config.logo.format");
        }
    }

    private static InvalidClubLogoException invalid(String code) {
        return new InvalidClubLogoException(code);
    }

    private record Image(String mediaType, int width, int height) {
    }
}
