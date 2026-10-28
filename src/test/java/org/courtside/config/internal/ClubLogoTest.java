package org.courtside.config.internal;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Random;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ClubLogoTest {

    @Test
    void givenAPngWithinTheLimits_whenParsing_thenItsCanonicalTypeAndDigestAreRetained() {
        // given
        byte[] content = image("png", 32, 24);

        // when
        ClubLogo logo = ClubLogo.parse(content);

        // then
        assertThat(logo.mediaType()).isEqualTo("image/png");
        assertThat(logo.digest()).matches("[0-9a-f]{64}");
        assertThat(logo.content()).isEqualTo(content).isNotSameAs(content);
    }

    @Test
    void givenAJpegWithinTheLimits_whenParsing_thenItIsAcceptedFromItsBytes() {
        // given
        byte[] content = image("jpeg", 40, 20);

        // when
        ClubLogo logo = ClubLogo.parse(content);

        // then
        assertThat(logo.mediaType()).isEqualTo("image/jpeg");
    }

    @Test
    void givenActiveOrMalformedContent_whenParsing_thenItIsRejectedAsAFormat() {
        // given
        byte[] content = "<svg onload='alert(1)'></svg>".getBytes(java.nio.charset.StandardCharsets.UTF_8);

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.format");
    }

    @Test
    void givenMoreThanOneMebibyte_whenParsing_thenItIsRejectedBeforeDecoding() {
        // given
        byte[] content = new byte[1024 * 1024 + 1];

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.tooLarge");
    }

    @Test
    void givenAnImageAboveTheDimensionLimit_whenParsing_thenItIsRejected() {
        // given
        byte[] content = image("png", 2049, 1);

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.dimensions");
    }

    @Test
    void givenForgedPngMetadata_whenParsing_thenACompleteDecodeIsRequired() {
        // given
        byte[] content = forgedPng(1, 1);

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.format");
    }

    @Test
    void givenDataAfterACompleteImage_whenParsing_thenOnlyTheDecodedImageIsRetained() throws Exception {
        // given
        byte[] image = image("png", 12, 12);
        byte[] content = java.util.Arrays.copyOf(image, image.length + 16);
        System.arraycopy("private metadata".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                0, content, image.length, 16);

        // when
        ClubLogo logo = ClubLogo.parse(content);

        // then
        assertThat(new String(logo.content(), java.nio.charset.StandardCharsets.ISO_8859_1))
                .doesNotContain("private metadata");
        assertThat(ImageIO.read(new java.io.ByteArrayInputStream(logo.content()))).isNotNull();
    }

    @Test
    void givenNoContent_whenParsing_thenItIsRejectedAsEmpty() {
        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(null))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.empty");
        assertThatThrownBy(() -> ClubLogo.parse(new byte[0]))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.empty");
    }

    @ParameterizedTest
    @CsvSource({"0, 1", "1, 0"})
    void givenAPngHeaderDeclaringAnEmptySide_whenParsing_thenItIsRejectedForItsDimensions(int width, int height) {
        // given
        byte[] content = forgedPng(width, height);

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.dimensions");
    }

    @Test
    void givenAnImageTallerThanTheDimensionLimit_whenParsing_thenItIsRejected() {
        // given
        byte[] content = image("png", 1, 2049);

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.dimensions");
    }

    @Test
    void givenAJpegWhoseHuffmanTablesPrecedeItsFrameHeader_whenParsing_thenTheTablesAreNotReadAsItsSize() {
        // given
        byte[] content = huffmanTablesFirst(image("jpeg", 40, 20));

        // when
        ClubLogo logo = ClubLogo.parse(content);

        // then
        assertThat(logo.mediaType()).isEqualTo("image/jpeg");
        assertThat(logo.width()).isEqualTo(40);
        assertThat(logo.height()).isEqualTo(20);
    }

    @Test
    void givenAJpegThatOnlyFitsTheLimitThroughItsOwnCompression_whenParsing_thenTheReencodedLogoIsRejected() {
        // given
        byte[] content = noiseJpeg(1700, 0.3f);
        assertThat(content.length).as("the upload itself must fit the limit").isLessThanOrEqualTo(1024 * 1024);

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.tooLarge");
    }

    @ParameterizedTest
    @ValueSource(ints = {12, 13, 14, 15})
    void givenAPngWhoseFirstChunkIsNotItsHeader_whenParsing_thenItIsRejectedAsAFormat(int chunkNameByte) {
        // given
        byte[] content = image("png", 12, 12);
        content[chunkNameByte] = 'x';

        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.format");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("malformedImages")
    void givenAnImageWhoseStructureCarriesNoUsableHeader_whenParsing_thenItIsRejectedAsAFormat(
            String defect, byte[] content) {
        // when / then
        assertThatThrownBy(() -> ClubLogo.parse(content))
                .as(defect)
                .isInstanceOf(InvalidClubLogoException.class)
                .extracting("code").isEqualTo("config.logo.format");
    }

    @Test
    void givenAStoredJpegWithItsOwnTypeAndDigest_whenItIsRead_thenItIsRestoredWithItsSize() {
        // given
        ClubLogo parsed = ClubLogo.parse(image("jpeg", 40, 20));

        // when
        ClubLogo stored = ClubLogo.stored(parsed.content(), "image/jpeg", parsed.digest());

        // then
        assertThat(stored.mediaType()).isEqualTo("image/jpeg");
        assertThat(stored.width()).isEqualTo(40);
        assertThat(stored.height()).isEqualTo(20);
        assertThat(stored.decoded().getWidth()).isEqualTo(40);
    }

    @Test
    void givenStoredContentOutsideTheSizeLimit_whenItIsRead_thenItFailsClosed() {
        // when / then
        for (byte[] content : new byte[][]{null, new byte[0], new byte[1024 * 1024 + 1]}) {
            assertThatThrownBy(() -> ClubLogo.stored(content, "image/png", "0".repeat(64)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("The stored club logo content is outside its size limit");
        }
    }

    @Test
    void givenStoredContentThatContradictsItsMetadata_whenItIsRead_thenItFailsClosed() {
        // given
        ClubLogo png = ClubLogo.parse(image("png", 12, 12));
        byte[] notAnImage = "plain text".getBytes(java.nio.charset.StandardCharsets.UTF_8);

        // when / then
        assertThatThrownBy(() -> ClubLogo.stored(notAnImage, "image/png", png.digest()))
                .as("content that is no image")
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The stored club logo metadata does not match its content");
        assertThatThrownBy(() -> ClubLogo.stored(png.content(), "image/jpeg", png.digest()))
                .as("a PNG recorded as a JPEG")
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The stored club logo metadata does not match its content");
        assertThatThrownBy(() -> ClubLogo.stored(png.content(), "image/png", "0".repeat(64)))
                .as("content that no longer matches its digest")
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("The stored club logo metadata does not match its content");
    }

    private static Stream<Arguments> malformedImages() {
        byte[] jpeg = image("jpeg", 8, 8);
        byte[] lastByteChanged = jpeg.clone();
        lastByteChanged[lastByteChanged.length - 1] = 0;
        return Stream.of(
                Arguments.of("a PNG signature without a header chunk", Arrays.copyOf(forgedPng(1, 1), 8)),
                Arguments.of("fewer bytes than a start and an end marker", bytes(0xff, 0xd8, 0xff)),
                Arguments.of("no start-of-image marker", bytes(0xff, 0x00, 0xff, 0xd9)),
                Arguments.of("a file cut before its end marker", Arrays.copyOf(jpeg, jpeg.length - 2)),
                Arguments.of("an end marker that is not one", lastByteChanged),
                Arguments.of("scan data before any frame header",
                        bytes(0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9)),
                Arguments.of("an end marker before any frame header",
                        bytes(0xff, 0xd8, 0xff, 0xd9, 0x00, 0x00, 0xff, 0xd9)),
                Arguments.of("a segment shorter than its own length field",
                        bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9)),
                Arguments.of("a segment longer than the file",
                        bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0xff, 0xd9)),
                Arguments.of("a frame header too short to carry a size",
                        bytes(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9)));
    }

    private static byte[] bytes(int... values) {
        byte[] result = new byte[values.length];
        for (int index = 0; index < values.length; index++) {
            result[index] = (byte) values[index];
        }
        return result;
    }

    private static byte[] forgedPng(int width, int height) {
        byte[] content = new byte[24];
        System.arraycopy(new byte[]{(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a},
                0, content, 0, 8);
        System.arraycopy(new byte[]{'I', 'H', 'D', 'R'}, 0, content, 12, 4);
        ByteBuffer.wrap(content).putInt(16, width).putInt(20, height);
        return content;
    }

    private static byte[] huffmanTablesFirst(byte[] jpeg) {
        ByteArrayOutputStream tables = new ByteArrayOutputStream();
        ByteArrayOutputStream others = new ByteArrayOutputStream();
        int offset = 2;
        while (Byte.toUnsignedInt(jpeg[offset + 1]) != 0xda) {
            int length = Byte.toUnsignedInt(jpeg[offset + 2]) << 8 | Byte.toUnsignedInt(jpeg[offset + 3]);
            ByteArrayOutputStream target = Byte.toUnsignedInt(jpeg[offset + 1]) == 0xc4 ? tables : others;
            target.write(jpeg, offset, length + 2);
            offset += length + 2;
        }
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        result.write(jpeg, 0, 2);
        result.writeBytes(tables.toByteArray());
        result.writeBytes(others.toByteArray());
        result.write(jpeg, offset, jpeg.length - offset);
        return result.toByteArray();
    }

    private static byte[] noiseJpeg(int side, float quality) {
        BufferedImage image = new BufferedImage(side, side, BufferedImage.TYPE_INT_RGB);
        Random random = new Random(1);
        for (int y = 0; y < side; y++) {
            for (int x = 0; x < side; x++) {
                image.setRGB(x, y, random.nextInt(0x1000000));
            }
        }
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ImageWriteParam param = writer.getDefaultWriteParam();
        param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
        param.setCompressionQuality(quality);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (MemoryCacheImageOutputStream stream = new MemoryCacheImageOutputStream(output)) {
            writer.setOutput(stream);
            writer.write(null, new IIOImage(image, null, null), param);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        } finally {
            writer.dispose();
        }
        return output.toByteArray();
    }

    private static byte[] image(String format, int width, int height) {
        try {
            BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!ImageIO.write(image, format, output)) {
                throw new IllegalStateException("The test image format is unavailable");
            }
            return output.toByteArray();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }
}
