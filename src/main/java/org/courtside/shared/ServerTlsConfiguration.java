package org.courtside.shared;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.server.ConfigurableWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ServerTlsProperties.class)
class ServerTlsConfiguration {

    @Bean
    WebServerFactoryCustomizer<ConfigurableWebServerFactory> serverTransport(
            ServerTlsProperties tls) {
        return factory -> ServerTls.apply(factory, tls);
    }

    // The customizer runs only where a web server is built, and material this instance cannot use
    // has to be refused wherever it is configured.
    @Bean
    SmartInitializingSingleton serverTransportMaterial(ServerTlsProperties tls,
            Environment environment) {
        return () -> ServerTls.check(tls, environment);
    }
}
