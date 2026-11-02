package org.courtside.config.web;

import com.jayway.jsonpath.JsonPath;
import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class HeaderLogoTest extends AbstractIntegrationTest {

    private static final String HEADER = "^/api/public/config/logo/header\\?v=[0-9a-f]{64}$";
    private static final String ORIGINAL = "^/api/public/config/logo\\?v=[0-9a-f]{64}$";

    @Autowired
    private WebApplicationContext context;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALargeUploadedLogo_whenThePublicConfigIsRead_thenItNamesASmallTransparentHeaderVariant() throws Exception {
        // given
        upload(transparentLogo("png", 703, 800));

        // when
        String headerUrl = publicLogoUrl();

        // then
        assertThat(headerUrl).as("the public config names the header variant").matches(HEADER);
        byte[] served = mockMvc.perform(get(headerUrl))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andExpect(header().string("Cache-Control", "max-age=31536000, public, immutable"))
                .andExpect(header().string("ETag", matchesPattern("\"[0-9a-f]{64}\"")))
                .andReturn().getResponse().getContentAsByteArray();
        BufferedImage variant = decode(served);
        assertThat(variant.getHeight()).as("the longest side is the header size").isEqualTo(160);
        assertThat(variant.getWidth()).as("the aspect ratio of 703:800 is kept").isEqualTo(141);
        assertThat(variant.getRGB(0, 0) >>> 24).as("a transparent corner stays transparent").isZero();
        assertThat(variant.getRGB(70, 80) >>> 24).as("the opaque centre stays opaque").isEqualTo(0xFF);
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(jsonPath("$.icons[0].src").value(matchesPattern(ORIGINAL)))
                .andExpect(jsonPath("$.icons[0].sizes").value("703x800"));
        mockMvc.perform(get("/api/admin/config"))
                .andExpect(jsonPath("$.logoUrl").value(matchesPattern(ORIGINAL)));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenASmallJpegLogo_whenTheHeaderVariantIsRead_thenItIsAPngThatIsNotEnlarged() throws Exception {
        // given
        upload(transparentLogo("jpeg", 120, 40));

        // when
        byte[] served = mockMvc.perform(get(publicLogoUrl()))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andReturn().getResponse().getContentAsByteArray();

        // then
        BufferedImage variant = decode(served);
        assertThat(variant.getWidth()).as("a logo below the header size keeps its width").isEqualTo(120);
        assertThat(variant.getHeight()).as("a logo below the header size keeps its height").isEqualTo(40);
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenALogoWhoseScaleIsNotExact_whenTheHeaderVariantIsRead_thenTheLongestSideIsStillTheHeaderSize() throws Exception {
        // given
        upload(transparentLogo("png", 303, 151));

        // when
        byte[] served = mockMvc.perform(get(publicLogoUrl()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();

        // then
        BufferedImage variant = decode(served);
        assertThat(variant.getWidth()).as("a scale of 160/303 still reaches 160 pixels").isEqualTo(160);
        assertThat(variant.getHeight()).as("the short side is rounded, not truncated").isEqualTo(80);
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAReplacedLogo_whenTheOldHeaderVersionIsRead_thenTheCurrentVariantIsServedUncached() throws Exception {
        // given
        upload(transparentLogo("png", 400, 400));
        String previous = publicLogoUrl();
        upload(transparentLogo("png", 300, 600));

        // when
        String current = publicLogoUrl();
        byte[] served = mockMvc.perform(get(previous))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-cache"))
                .andReturn().getResponse().getContentAsByteArray();

        // then
        assertThat(current).as("a new logo gets a new header version").isNotEqualTo(previous);
        assertThat(decode(served).getWidth()).as("the stale version answers with the current logo").isEqualTo(80);
    }

    @Test
    void givenNoUploadedLogo_whenTheHeaderVariantIsRead_thenTheTypedNotFoundProblemIsServed() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/config/logo/header"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:club-logo-not-found"))
                .andExpect(jsonPath("$.detail").value("This instance has no uploaded club logo"));
    }

    private void upload(byte[] content) throws Exception {
        mockMvc.perform(multipart(HttpMethod.PUT, "/api/admin/config/logo")
                        .file(new MockMultipartFile("file", "club.png", "image/png", content))
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    private String publicLogoUrl() throws Exception {
        String body = mockMvc.perform(get("/api/public/config"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.logoUrl");
    }

    private static BufferedImage decode(byte[] bytes) throws IOException {
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        assertThat(image).as("the variant decodes as an image").isNotNull();
        return image;
    }

    private static byte[] transparentLogo(String format, int width, int height) {
        boolean png = format.equals("png");
        BufferedImage image = new BufferedImage(width, height,
                png ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        int inset = Math.min(width, height) / 4;
        for (int y = inset; y < height - inset; y++) {
            for (int x = inset; x < width - inset; x++) {
                image.setRGB(x, y, 0xFFF0EA5B);
            }
        }
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!ImageIO.write(image, format, output)) {
                throw new IllegalStateException("The test image format is unavailable");
            }
            return output.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
