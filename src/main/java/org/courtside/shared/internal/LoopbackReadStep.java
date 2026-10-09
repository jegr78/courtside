package org.courtside.shared.internal;

import org.courtside.shared.ServerTlsProperties;
import org.courtside.shared.WarmUpStep;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class LoopbackReadStep implements WarmUpStep {

    static final int ROUND_BUDGET = 40;

    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private static final String RATE_LIMITED = "urn:courtside:error:request-rate-limited";
    private static final Pattern PROBLEM_TYPE = Pattern.compile("\"type\"\\s*:\\s*\"(urn:courtside:error:[a-z0-9-]+)\"");

    private final String name;
    private final Supplier<List<String>> paths;
    private final ApplicationContext context;
    private final ServerTlsProperties tls;

    LoopbackReadStep(String name, Supplier<List<String>> paths, ApplicationContext context, ServerTlsProperties tls) {
        this.name = name;
        this.paths = paths;
        this.context = context;
        this.tls = tls;
    }

    @Override
    public String name() {
        return name;
    }

    // The loopback reads spend the loopback address's request budget and end early once it is spent.
    @Override
    public int roundBudget() {
        return ROUND_BUDGET;
    }

    @Override
    public boolean run() throws IOException, InterruptedException, URISyntaxException {
        // The certificate names the club's host, not the loopback address this step connects to.
        if (!(context instanceof WebServerApplicationContext web) || tls.mode() == ServerTlsProperties.Mode.SERVE) {
            return false;
        }
        WebServer server = web.getWebServer();
        if (server == null || server.getPort() <= 0) {
            return false;
        }
        try (HttpClient client = HttpClient.newBuilder()
                .proxy(HttpClient.Builder.NO_PROXY).connectTimeout(REQUEST_TIMEOUT).build()) {
            for (String target : paths.get()) {
                int query = target.indexOf('?');
                URI uri = new URI("http", null, "127.0.0.1", server.getPort(),
                        query < 0 ? target : target.substring(0, query),
                        query < 0 ? null : target.substring(query + 1), null);
                HttpResponse<String> response = client.send(HttpRequest.newBuilder(uri)
                        .timeout(REQUEST_TIMEOUT)
                        .GET()
                        .build(), HttpResponse.BodyHandlers.ofString());
                String problemType = problemType(response.body());
                if (response.statusCode() == 429 && RATE_LIMITED.equals(problemType)) {
                    return false;
                }
                if (response.statusCode() / 100 != 2) {
                    throw new WarmUpRequestRefusedException(target, response.statusCode(), problemType);
                }
            }
        }
        return true;
    }

    private static String problemType(String body) {
        Matcher type = PROBLEM_TYPE.matcher(body == null ? "" : body);
        return type.find() ? type.group(1) : "none";
    }
}
