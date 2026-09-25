package org.courtside.config.web;

import org.courtside.AbstractIntegrationTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class InstalledAppTest extends AbstractIntegrationTest {

    private static final String ICON = "^/api/public/config/icon\\?size=%d(&purpose=maskable)?&v=[0-9a-f]{64}$";
    private static final int SHADE = 0xFF17211D;
    private static final int LINE = 0xFFFCFBF9;
    private static final int CLAY = 0xFFAF5030;
    private static final int LOGO_RED = 0xFFCC0000;

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private JdbcClient jdbc;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }

    @Test
    void whenReadingTheManifest_thenItDescribesTheClubInItsDefaultLanguage() throws Exception {
        // when / then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("/"))
                .andExpect(jsonPath("$.name").value("Courtside"))
                .andExpect(jsonPath("$.short_name").value("Courtside"))
                .andExpect(jsonPath("$.lang").value("de"))
                .andExpect(jsonPath("$.description").value("Plätze buchen bei Courtside"))
                .andExpect(jsonPath("$.start_url").value("/"))
                .andExpect(jsonPath("$.display").value("standalone"))
                .andExpect(jsonPath("$.theme_color").value("#AF5030"))
                .andExpect(jsonPath("$.background_color").value("#101713"))
                .andExpect(jsonPath("$.shortcuts.length()").value(2))
                .andExpect(jsonPath("$.shortcuts[0].name").value("Platzplan"))
                .andExpect(jsonPath("$.shortcuts[0].url").value("/courts"))
                .andExpect(jsonPath("$.shortcuts[1].name").value("Meine Buchungen"))
                .andExpect(jsonPath("$.shortcuts[1].url").value("/my-bookings"));
    }

    @Test
    void givenAnEnglishSpeakingClub_whenReadingTheManifest_thenItsTextFollowsTheDefaultLanguage()
            throws Exception {
        // given
        jdbc.sql("UPDATE club_config SET default_locale = 'en', club_name = 'Example Tennis Club'").update();

        // when / then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lang").value("en"))
                .andExpect(jsonPath("$.description").value("Book courts at Example Tennis Club"))
                .andExpect(jsonPath("$.shortcuts[0].name").value("Court plan"))
                .andExpect(jsonPath("$.shortcuts[1].name").value("My bookings"));
    }

    @Test
    void whenReadingTheManifest_thenEveryIconNamesItsSizeTypeAndPurpose() throws Exception {
        // when / then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.icons.length()").value(5))
                .andExpect(jsonPath("$.icons[0].src").value("/icon.svg"))
                .andExpect(jsonPath("$.icons[0].sizes").value("any"))
                .andExpect(jsonPath("$.icons[0].type").value("image/svg+xml"))
                .andExpect(jsonPath("$.icons[0].purpose").value("any"))
                .andExpect(jsonPath("$.icons[1].src").value(matchesPattern(ICON.formatted(192))))
                .andExpect(jsonPath("$.icons[1].sizes").value("192x192"))
                .andExpect(jsonPath("$.icons[1].type").value("image/png"))
                .andExpect(jsonPath("$.icons[1].purpose").value("any"))
                .andExpect(jsonPath("$.icons[2].src").value(matchesPattern(ICON.formatted(512))))
                .andExpect(jsonPath("$.icons[2].sizes").value("512x512"))
                .andExpect(jsonPath("$.icons[2].purpose").value("any"))
                .andExpect(jsonPath("$.icons[3].src").value(matchesPattern(
                        "^/api/public/config/icon\\?size=192&purpose=maskable&v=[0-9a-f]{64}$")))
                .andExpect(jsonPath("$.icons[3].sizes").value("192x192"))
                .andExpect(jsonPath("$.icons[3].type").value("image/png"))
                .andExpect(jsonPath("$.icons[3].purpose").value("maskable"))
                .andExpect(jsonPath("$.icons[4].src").value(matchesPattern(
                        "^/api/public/config/icon\\?size=512&purpose=maskable&v=[0-9a-f]{64}$")))
                .andExpect(jsonPath("$.icons[4].sizes").value("512x512"))
                .andExpect(jsonPath("$.icons[4].purpose").value("maskable"));
    }

    @Test
    void givenAClubNameLongerThanAnIconLabel_whenReadingTheManifest_thenTheShortNameKeepsItsLeadingWords()
            throws Exception {
        // given
        jdbc.sql("UPDATE club_config SET club_name = 'Example Tennis Club'").update();

        // when / then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Example Tennis Club"))
                .andExpect(jsonPath("$.short_name").value("Example"));
    }

    @Test
    void givenAClubNameWhoseFirstWordIsTooLong_whenReadingTheManifest_thenTheShortNameIsCutToTheBound()
            throws Exception {
        // given
        jdbc.sql("UPDATE club_config SET club_name = 'Racquetsportsclub Example'").update();

        // when / then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.short_name").value("Racquetsport"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAChosenShortName_whenReadingTheManifest_thenItReplacesTheDerivedOne() throws Exception {
        // given
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("\"ETC Example\""))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shortName").value("ETC Example"));

        // when / then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Example Tennis Club"))
                .andExpect(jsonPath("$.short_name").value("ETC Example"));
        mockMvc.perform(get("/api/admin/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shortName").value("ETC Example"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAChosenShortName_whenItIsCleared_thenTheManifestDerivesOneAgain() throws Exception {
        // given
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("\"ETC Example\""))
                        .with(csrf()))
                .andExpect(status().isOk());

        // when
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("null"))
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.shortName").hasJsonPath())
                .andExpect(jsonPath("$.shortName").doesNotExist());

        // then
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.short_name").value("Example"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAShortNameLongerThanAnIconLabel_whenChangingTheConfig_thenTheViolationCarriesTheBound()
            throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("\"Example Tennis\""))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors.length()").value(1))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("shortName"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Size"))
                .andExpect(jsonPath("$.fieldErrors[0].params.max").value(12));
        assertThat(jdbc.sql("SELECT count(*) FROM club_config WHERE short_name IS NOT NULL")
                .query(Integer.class).single())
                .as("a refused short name must not have been stored")
                .isZero();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenABlankShortName_whenChangingTheConfig_thenTheFieldIsRefused() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("\"   \""))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("shortName"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAShortNameOfUnicodeSpaces_whenChangingTheConfig_thenTheFieldIsRefusedLikeABlankOne() throws Exception {
        // when / then
        mockMvc.perform(put("/api/admin/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(configJson("\"\u2003\u3000\""))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:validation-failed"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("shortName"))
                .andExpect(jsonPath("$.fieldErrors[0].code").value("validation.Pattern"));
    }

    @Test
    void givenNoUploadedLogo_whenReadingTheIcon_thenItIsTheCourtsideMarkAtTheRequestedSize()
            throws Exception {
        // when
        BufferedImage icon = icon("/api/public/config/icon?size=192");

        // then
        assertThat(icon.getWidth()).isEqualTo(192);
        assertThat(icon.getHeight()).isEqualTo(192);
        assertThat(icon.getRGB(0, 0) >>> 24).as("the tile's rounded corner stays transparent").isZero();
        assertThat(icon.getRGB(96, 150)).as("the court inside the tile is shade").isEqualTo(SHADE);
        assertThat(icon.getRGB(46, 96)).as("the alley is clay").isEqualTo(CLAY);
        assertThat(icon.getRGB(96, 93)).as("the service line is line-coloured").isEqualTo(LINE);
    }

    @Test
    void givenNoUploadedLogo_whenReadingTheMaskableIcon_thenTheMarkSitsInsideTheSafeZoneOnShade()
            throws Exception {
        // when
        BufferedImage icon = icon("/api/public/config/icon?size=512&purpose=maskable");

        // then
        assertThat(icon.getWidth()).isEqualTo(512);
        assertThat(icon.getRGB(0, 0)).as("a maskable icon is opaque to its corners").isEqualTo(SHADE);
        assertSafeZone(icon, SHADE);
        assertThat(countOf(icon, CLAY)).as("the mark is drawn, not just the background").isPositive();
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUploadedLogo_whenReadingTheIcons_thenTheyAreRasterisedFromIt() throws Exception {
        // given
        upload(transparentCornerLogo(100, 60));

        // when
        BufferedImage any = icon("/api/public/config/icon?size=512");
        BufferedImage maskable = icon("/api/public/config/icon?size=512&purpose=maskable");
        BufferedImage apple = icon("/api/public/config/icon?size=180&purpose=maskable");

        // then
        assertThat(any.getWidth()).isEqualTo(512);
        assertThat(any.getHeight()).isEqualTo(512);
        assertThat(any.getRGB(256, 256)).as("the logo fills the icon's width").isEqualTo(LOGO_RED);
        assertThat(any.getRGB(10, 256)).as("the logo keeps its width").isEqualTo(LOGO_RED);
        assertThat(any.getRGB(256, 10) >>> 24).as("the logo keeps its aspect ratio").isZero();
        assertThat(maskable.getRGB(0, 0)).as("a transparent logo sits on white").isEqualTo(0xFFFFFFFF);
        assertThat(maskable.getRGB(256, 256)).isEqualTo(LOGO_RED);
        assertSafeZone(maskable, 0xFFFFFFFF);
        assertThat(apple.getWidth()).isEqualTo(180);
        assertThat(apple.getRGB(90, 90)).isEqualTo(LOGO_RED);
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnOpaqueLogo_whenReadingTheMaskableIcon_thenItsOwnBackgroundFillsTheMask() throws Exception {
        // given
        upload(solidLogo(64, 64, 0xFF1A4D8F));

        // when
        BufferedImage maskable = icon("/api/public/config/icon?size=192&purpose=maskable");

        // then
        assertThat(maskable.getRGB(0, 0)).isEqualTo(0xFF1A4D8F);
        assertThat(maskable.getRGB(191, 191)).isEqualTo(0xFF1A4D8F);
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void givenAnUploadedLogo_whenReadingTheManifest_thenTheIconVersionFollowsTheLogo() throws Exception {
        // given
        String before = iconSource(1);

        // when
        upload(transparentCornerLogo(40, 40));

        // then
        String after = iconSource(1);
        assertThat(after).matches(ICON.formatted(192)).isNotEqualTo(before);
        mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(jsonPath("$.icons[0].src").value(matchesPattern(
                        "^/api/public/config/logo\\?v=[0-9a-f]{64}$")))
                .andExpect(jsonPath("$.icons[0].type").value("image/png"))
                .andExpect(jsonPath("$.icons[0].sizes").value("40x40"));
    }

    @Test
    void givenTheVersionTheManifestNames_whenReadingTheIcon_thenItIsCachedAsImmutable() throws Exception {
        // given
        String source = iconSource(2);

        // when / then
        mockMvc.perform(get(source))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andExpect(header().string("Cache-Control", "max-age=31536000, public, immutable"))
                .andExpect(header().string("ETag", matchesPattern("\"[0-9a-f]{64}-512-any\"")));
    }

    @Test
    void givenAVersionThatIsNoLongerCurrent_whenReadingTheIcon_thenTheCurrentIconIsServedUncached()
            throws Exception {
        // when
        byte[] served = mockMvc.perform(get("/api/public/config/icon?size=192&v=" + "0".repeat(64)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-cache"))
                .andReturn().getResponse().getContentAsByteArray();

        // then
        assertThat(ImageIO.read(new ByteArrayInputStream(served)).getWidth()).isEqualTo(192);
    }

    @Test
    void givenASizeTheManifestNeverNames_whenReadingTheIcon_thenTheTypedRefusalNamesTheParameter()
            throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/config/icon?size=4096"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:app-icon-unsupported"))
                .andExpect(jsonPath("$.violations[0].code").value("config.icon.unsupported"))
                .andExpect(jsonPath("$.violations[0].params.parameter").value("size"));
    }

    @Test
    void givenNoSize_whenReadingTheIcon_thenTheTypedRefusalNamesTheMissingParameter() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/config/icon"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:missing-parameter"))
                .andExpect(jsonPath("$.violations[0].params.parameter").value("size"));
    }

    @Test
    void givenAnUnknownPurpose_whenReadingTheIcon_thenTheTypedRefusalNamesThePurpose() throws Exception {
        // when / then
        mockMvc.perform(get("/api/public/config/icon?size=192&purpose=monochrome"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value("urn:courtside:error:app-icon-unsupported"))
                .andExpect(jsonPath("$.violations[0].params.parameter").value("purpose"));
    }

    private String iconSource(int index) throws Exception {
        String manifest = mockMvc.perform(get("/manifest.webmanifest"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(manifest, "$.icons[" + index + "].src");
    }

    private BufferedImage icon(String url) throws Exception {
        byte[] served = mockMvc.perform(get(url))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.IMAGE_PNG))
                .andReturn().getResponse().getContentAsByteArray();
        BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(served));
        assertThat(decoded).as("the icon endpoint must answer with a decodable PNG").isNotNull();
        return decoded;
    }

    private void upload(byte[] logo) throws Exception {
        mockMvc.perform(multipart(HttpMethod.PUT, "/api/admin/config/logo")
                        .file(new MockMultipartFile("file", "club.png", "image/png", logo))
                        .with(csrf()))
                .andExpect(status().isOk());
    }

    private static void assertSafeZone(BufferedImage icon, int background) {
        double centre = icon.getWidth() / 2.0;
        double radius = icon.getWidth() * 0.4;
        for (int y = 0; y < icon.getHeight(); y++) {
            for (int x = 0; x < icon.getWidth(); x++) {
                if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > radius) {
                    assertThat(icon.getRGB(x, y))
                            .as("pixel %d,%d lies outside the central 80 %% a launcher may crop to", x, y)
                            .isEqualTo(background);
                }
            }
        }
    }

    private static long countOf(BufferedImage icon, int colour) {
        long count = 0;
        for (int y = 0; y < icon.getHeight(); y++) {
            for (int x = 0; x < icon.getWidth(); x++) {
                if (icon.getRGB(x, y) == colour) count++;
            }
        }
        return count;
    }

    private static byte[] transparentCornerLogo(int width, int height) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                image.setRGB(x, y, LOGO_RED);
            }
        }
        image.setRGB(0, 0, 0);
        return png(image);
    }

    private static byte[] solidLogo(int width, int height, int colour) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                image.setRGB(x, y, colour);
            }
        }
        return png(image);
    }

    private static byte[] png(BufferedImage image) {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            ImageIO.write(image, "png", output);
            return output.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String configJson(String shortName) {
        return """
                {"clubName": "Example Tennis Club", "shortName": %s, "primaryColor": "#004f2d",
                 "accentColor": "#c8a415", "defaultLocale": "de", "timeZone": "Europe/Berlin",
                 "slotMinutes": 30, "newAccountCredentialHours": 168, "passwordResetCredentialHours": 24,
                 "passwordResetTokenMinutes": 60, "bookingReminderHours": 24}
                """.formatted(shortName);
    }
}
