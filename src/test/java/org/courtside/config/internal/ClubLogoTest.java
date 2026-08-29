package org.courtside.config.internal;

import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;

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
        byte[] content = new byte[24];
        System.arraycopy(new byte[]{(byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a},
                0, content, 0, 8);
        System.arraycopy(new byte[]{'I', 'H', 'D', 'R'}, 0, content, 12, 4);
        content[19] = 1;
        content[23] = 1;

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
