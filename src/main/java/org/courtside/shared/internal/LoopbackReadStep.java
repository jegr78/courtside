package org.courtside.shared.internal;

import org.courtside.shared.WarmUpStep;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class LoopbackReadStep implements WarmUpStep {

    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private static final Pattern PROBLEM_TYPE = Pattern.compile("\"type\"\\s*:\\s*\"(urn:courtside:error:[a-z0-9-]+)\"");

    private final String name;
    private final ApplicationContext context;
    private final Supplier<List<String>> paths;

    LoopbackReadStep(String name, ApplicationContext context, Supplier<List<String>> paths) {
        this.name = name;
        this.context = context;
        this.paths = paths;
    }

    @Override
    public String name() {
        return name;
    }

    @Override
    public boolean run() throws IOException, InterruptedException {
        if (!(context instanceof WebServerApplicationContext web) || servesTls()) {
            return false;
        }
        WebServer server = web.getWebServer();
        if (server == null || server.getPort() <= 0) {
            return false;
        }
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(REQUEST_TIMEOUT).build()) {
            for (String path : paths.get()) {
                HttpResponse<String> response = client.send(HttpRequest.newBuilder(
                                URI.create("http://127.0.0.1:" + server.getPort() + path))
                        .header("Accept", "application/json, */*;q=0.8")
                        .timeout(REQUEST_TIMEOUT)
                        .GET()
                        .build(), HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() / 100 != 2) {
                    throw new WarmUpRequestRefusedException(path, response.statusCode(), problemType(response.body()));
                }
            }
        }
        return true;
    }

    // The certificate names the club's host, not the loopback address this step connects to.
    private boolean servesTls() {
        return Binder.get(context.getEnvironment()).bind("courtside.server.tls.mode", String.class)
                .map("serve"::equalsIgnoreCase)
                .orElse(false);
    }

    private static String problemType(String body) {
        Matcher type = PROBLEM_TYPE.matcher(body == null ? "" : body);
        return type.find() ? type.group(1) : "none";
    }
}
