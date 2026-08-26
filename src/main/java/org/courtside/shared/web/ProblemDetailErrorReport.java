package org.courtside.shared.web;

import org.apache.catalina.core.StandardHost;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.stereotype.Component;

@Component
class ProblemDetailErrorReport implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {

    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        factory.addContextCustomizers(context -> {
            if (context.getParent() instanceof StandardHost host) {
                host.setErrorReportValveClass(ProblemDetailErrorReportValve.class.getName());
            }
        });
    }
}
