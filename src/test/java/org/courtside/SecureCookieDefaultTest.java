package org.courtside;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.FileSystemResource;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

class SecureCookieDefaultTest {

    private final YamlPropertySourceLoader loader = new YamlPropertySourceLoader();

    @Test
    void whenReadingProductionConfiguration_thenSessionCookiesDefaultToSecure() throws IOException {
        // when
        Object secure = load("src/main/resources/application.yaml")
                .getProperty("server.servlet.session.cookie.secure");

        // then
        assertThat(secure).isEqualTo("${COURTSIDE_COOKIE_SECURE:true}");
    }

    @Test
    void whenReadingTestConfiguration_thenSessionCookiesSupportPlainHttp() throws IOException {
        // when
        Object secure = load("src/test/resources/application-test.yaml")
                .getProperty("server.servlet.session.cookie.secure");

        // then
        assertThat(secure).isEqualTo(false);
    }

    private PropertySource<?> load(String path) throws IOException {
        return loader.load(path, new FileSystemResource(path)).getFirst();
    }
}
