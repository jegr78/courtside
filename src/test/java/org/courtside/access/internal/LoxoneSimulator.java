package org.courtside.access.internal;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import org.courtside.TestCertificate;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.ssl.SslBundle;
import org.springframework.boot.ssl.pem.PemSslStoreBundle;
import org.springframework.boot.ssl.pem.PemSslStoreDetails;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.SSLContext;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Stream;

/** A Miniserver and the Loxone Cloud resolver over HTTPS, stateful enough to hold users, groups and tokens. */
final class LoxoneSimulator implements AutoCloseable {

    static final String USER = "courtside-service";
    static final String PASSWORD = "example-service-password";
    static final String SERIAL = "504F94A0EE01";
    static final int USER_MANAGEMENT = 0x800;
    static final int CHANGE_PASSWORD = 0x20;

    private static final Set<String> MUTATING = Set.of("addoredituser", "deleteuser", "updateuseraccesscode",
            "assignusertogroup", "removeuserfromgroup", "createuser");
    private static final Instant EPOCH = Instant.parse("2009-01-01T00:00:00Z");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();

    record Request(String server, String command, List<String> arguments, boolean authenticated) {

        boolean mutating() {
            return MUTATING.contains(command);
        }

        boolean names(String text) {
            return arguments.stream().anyMatch(argument -> argument.contains(text));
        }
    }

    record Group(String uuid, String name, int type) {
    }

    record Token(String token, String user, long validUntil, int rights) {
    }

    static final class User {
        final String uuid;
        String name;
        final boolean admin;
        int userState;
        long validFrom;
        long validUntil;
        int expirationAction;
        boolean changePassword = true;
        List<String> groups = new ArrayList<>();
        @Nullable String code;

        User(String uuid, String name, boolean admin) {
            this.uuid = uuid;
            this.name = name;
            this.admin = admin;
        }

        String state() {
            return String.join("|", uuid, name, String.valueOf(admin), String.valueOf(userState),
                    String.valueOf(validFrom), String.valueOf(validUntil), String.valueOf(expirationAction),
                    String.valueOf(changePassword), String.valueOf(groups), String.valueOf(code));
        }
    }

    private static @Nullable Credentials credentials;

    private record Credentials(SSLContext server, SSLContext client) {
    }

    private final UUID foreignGrantId = UUID.randomUUID();
    private final UUID adminGrantId = UUID.randomUUID();
    private final Clock clock;
    private final ExecutorService handlers = Executors.newVirtualThreadPerTaskExecutor();
    private final CountDownLatch released = new CountDownLatch(1);
    private final List<Request> requests = new CopyOnWriteArrayList<>();
    private final Map<String, User> users = new LinkedHashMap<>();
    private final Map<String, Group> groups = new LinkedHashMap<>();
    private final Map<String, Token> tokens = new HashMap<>();
    private final Map<String, Integer> forced = new HashMap<>();
    private final Map<String, String> foreignStates = new LinkedHashMap<>();
    private final List<String> clientUuids = new ArrayList<>();
    private final List<Integer> permissions = new ArrayList<>();
    private final String salt = HexFormat.of().formatHex(randomBytes(8));
    private final HttpsServer cloud;
    private HttpsServer miniserver;
    private @Nullable HttpsServer moved;
    private @Nullable String pendingKey;
    private String hashAlgorithm = "SHA256";
    private Duration tokenLifetime = Duration.ofDays(20);
    private boolean withoutUserManagement;
    private boolean withoutChangePassword;
    private boolean refuseEveryToken;
    private boolean renameUsers;
    private boolean vanishBeforeCode;
    private boolean failCodeClearing;
    private boolean nameTakenOnCreate;
    private boolean ignoreDeletes;
    private boolean answerAsMember;
    private int brokenPort = -1;
    private final Map<String, Integer> bare = new HashMap<>();
    private final Map<String, String> rawAnswers = new HashMap<>();
    private @Nullable String cloudBody;
    private @Nullable URI resolvedTo;
    private @Nullable String hanging;
    private int refusals;
    private @Nullable Instant lockedUntil;
    private String version = "14.2.5.16";
    private final Set<String> omittedOnReadBack = new HashSet<>();

    LoxoneSimulator(Clock clock) throws IOException {
        this.clock = clock;
        Credentials issued = credentials();
        this.cloud = served(issued.server(), this::cloud);
        this.miniserver = served(issued.server(), this::miniserver);
        seed();
    }

    private void seed() {
        group("Members", 0);
        group("Court 1", 0);
        group("Court 2", 0);
        group("Administrators", 1);
        group("All", 2);
        group("Nobody", 3);
        group("All Access", 4);
        User admin = add("admin", true);
        admin.groups.add(groupUuid("Administrators"));
        User member = add("jane.doe", false);
        member.code = "135790";
        member.groups.add(groupUuid("Members"));
        User foreign = add(nameOf(foreignGrantId), false);
        foreign.userState = 4;
        foreign.code = "246801";
        foreign.groups.add(groupUuid("Court 1"));
        add("courtside_" + "a".repeat(32) + "_old", false);
        add("Courtside_" + "B".repeat(32), false);
        add(nameOf(adminGrantId), true);
        users.values().forEach(user -> foreignStates.put(user.uuid, user.state()));
    }

    UUID foreignGrantId() {
        return foreignGrantId;
    }

    UUID adminGrantId() {
        return adminGrantId;
    }

    static String nameOf(UUID grantId) {
        return "courtside_" + grantId.toString().replace("-", "");
    }

    static SSLContext clientTrust() {
        try {
            return credentials().client();
        } catch (IOException unavailable) {
            throw new IllegalStateException("the simulator certificate could not be issued", unavailable);
        }
    }

    private static synchronized Credentials credentials() throws IOException {
        if (credentials == null) {
            try {
                TestCertificate issued = TestCertificate.issuedFor("localhost");
                SSLContext server = SslBundle.of(new PemSslStoreBundle(
                        PemSslStoreDetails.forCertificate(issued.certificate()).withPrivateKey(issued.key()),
                        null)).createSslContext();
                SSLContext client = SslBundle.of(new PemSslStoreBundle(null,
                        PemSslStoreDetails.forCertificate(issued.authority()))).createSslContext();
                credentials = new Credentials(server, client);
            } catch (Exception failed) {
                throw new IOException("the simulator certificate could not be issued", failed);
            }
        }
        return credentials;
    }

    private HttpsServer served(SSLContext context, Handler handler) throws IOException {
        HttpsServer server = HttpsServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(context));
        server.setExecutor(handlers);
        server.createContext("/", exchange -> {
            try (exchange) {
                handler.handle(exchange);
            }
        });
        server.start();
        return server;
    }

    @FunctionalInterface
    private interface Handler {
        void handle(HttpExchange exchange) throws IOException;
    }

    URI url() {
        return URI.create("https://localhost:" + current().getAddress().getPort());
    }

    URI resolver() {
        return URI.create("https://localhost:" + cloud.getAddress().getPort());
    }

    private synchronized HttpsServer current() {
        return moved == null ? miniserver : moved;
    }

    LoxoneSettings settingsByUrl(Duration deadline) {
        return new LoxoneSettings(new LoxoneAddress.Fixed(url()), USER, PASSWORD, deadline);
    }

    LoxoneSettings settingsBySerial(Duration deadline) {
        return settingsBySerial(deadline, List.of(new LoxoneAddress.Relay("localhost", 1, 65_535)));
    }

    LoxoneSettings settingsBySerial(Duration deadline, List<LoxoneAddress.Relay> relays) {
        return new LoxoneSettings(new LoxoneAddress.Serial(SERIAL, resolver(), relays), USER, PASSWORD,
                deadline);
    }

    synchronized void resolveTo(URI address) {
        resolvedTo = address;
    }

    synchronized void ignoreDeletes() {
        ignoreDeletes = true;
    }

    synchronized void moveRelayLeavingAnErrorPage() throws IOException {
        HttpsServer next = served(credentials().server(), this::miniserver);
        brokenPort = current().getAddress().getPort();
        moved = next;
    }

    synchronized void answerRaw(String command, String body) {
        rawAnswers.put(command, body);
    }

    synchronized void resolveWithBody(String body) {
        cloudBody = body;
    }

    synchronized void answerBare(String command, int status) {
        bare.put(command, status);
    }

    synchronized void answerEditsWithTheMember() {
        answerAsMember = true;
    }

    long countAtTheBrokenRelay() {
        return requests.stream().filter(request -> request.server().equals("broken relay")).count();
    }

    synchronized void moveRelay() throws IOException {
        HttpsServer next = served(credentials().server(), this::miniserver);
        HttpsServer previous = current();
        moved = next;
        previous.stop(0);
    }

    synchronized void force(String command, int code) {
        forced.put(command, code);
    }

    synchronized void release(String command) {
        forced.remove(command);
    }

    synchronized void hashWith(String algorithm) {
        hashAlgorithm = algorithm;
    }

    synchronized void issueTokensFor(Duration lifetime) {
        tokenLifetime = lifetime;
    }

    synchronized void withholdUserManagement() {
        withoutUserManagement = true;
    }

    synchronized void withholdChangePassword() {
        withoutChangePassword = true;
    }

    synchronized void expireTokens() {
        tokens.clear();
    }

    synchronized void refuseEveryToken() {
        refuseEveryToken = true;
    }

    synchronized void renameUsers() {
        renameUsers = true;
    }

    synchronized void vanishBeforeCode() {
        vanishBeforeCode = true;
    }

    synchronized void failCodeClearing() {
        failCodeClearing = true;
    }

    synchronized void takeNameOnCreate() {
        nameTakenOnCreate = true;
    }

    synchronized void version(String configVersion) {
        version = configVersion;
    }

    synchronized void omitOnReadBack(String field) {
        omittedOnReadBack.add(field);
    }

    synchronized void hang(String command) {
        hanging = command;
    }

    synchronized User addUser(String name, @Nullable String code) {
        User user = add(name, false);
        user.code = code;
        return user;
    }

    synchronized User addUser(String name, String uuid, boolean admin) {
        User user = new User(uuid, name, admin);
        users.put(uuid, user);
        return user;
    }

    synchronized void removeGroup(String name) {
        groups.remove(groupUuid(name));
    }

    synchronized String groupUuid(String name) {
        return groups.values().stream().filter(group -> group.name().equals(name)).map(Group::uuid)
                .findFirst().orElseThrow(() -> new IllegalStateException("no simulated group " + name));
    }

    synchronized List<User> usersNamed(String name) {
        return users.values().stream().filter(user -> user.name.equals(name)).toList();
    }

    synchronized Optional<User> user(String uuid) {
        return Optional.ofNullable(users.get(uuid));
    }

    synchronized Set<String> issuedTokens() {
        return Set.copyOf(tokens.keySet());
    }

    synchronized int refusalsForMissingRights() {
        return refusals;
    }

    synchronized List<String> clientUuids() {
        return List.copyOf(clientUuids);
    }

    synchronized List<Integer> permissions() {
        return List.copyOf(permissions);
    }

    synchronized String salt() {
        return salt;
    }

    List<Request> requests() {
        return List.copyOf(requests);
    }

    List<String> commands() {
        return requests.stream().map(Request::command).toList();
    }

    long count(String command) {
        return requests.stream().filter(request -> request.command().equals(command)).count();
    }

    void forgetRequests() {
        requests.clear();
    }

    synchronized List<String> untouchedForeignUsersViolations() {
        List<String> violations = new ArrayList<>();
        foreignStates.forEach((uuid, state) -> {
            User now = users.get(uuid);
            if (now == null || !now.state().equals(state)) {
                violations.add("foreign user " + uuid + " changed");
            }
            String name = state.split("\\|")[1];
            requests.stream().filter(Request::mutating)
                    .filter(request -> request.names(uuid) || request.names("\"" + name + "\""))
                    .forEach(request -> violations.add(request.command() + " named foreign user " + uuid));
        });
        return violations;
    }

    long loxoneSeconds(Instant instant) {
        return Duration.between(EPOCH, instant).getSeconds();
    }

    private void cloud(HttpExchange exchange) throws IOException {
        URI uri = exchange.getRequestURI();
        requests.add(new Request("cloud", uri.getPath().replace("/", ""), List.of(String.valueOf(uri.getQuery())),
                false));
        Integer code;
        URI target;
        String body;
        synchronized (this) {
            code = forced.get("getip");
            target = resolvedTo == null ? url() : resolvedTo;
            body = cloudBody;
        }
        if (body != null) {
            respond(exchange, 200, body);
        } else if (code != null) {
            respond(exchange, code, "{\"error\":\"simulated\",\"code\":" + code + "}");
        } else if (!uri.getPath().equals("/getip") || !("snr=" + SERIAL).equals(uri.getQuery())) {
            respond(exchange, 404, "{\"error\":\"No relay found\"}");
        } else {
            respond(exchange, 200, "{\"url\":\"" + target + "\"}");
        }
    }

    private void miniserver(HttpExchange exchange) throws IOException {
        URI uri = exchange.getRequestURI();
        synchronized (this) {
            if (exchange.getLocalAddress().getPort() == brokenPort) {
                requests.add(new Request("broken relay", uri.getPath(), List.of(), false));
                respond(exchange, 502, "<html><body>502 Bad Gateway</body></html>");
                return;
            }
        }
        String raw = uri.getRawPath();
        String control = uri.toString();
        Map<String, String> query = query(uri.getRawQuery());
        String prefix = Stream.of("/jdev/sps/", "/jdev/sys/", "/jdev/cfg/").filter(raw::startsWith).findFirst()
                .orElse("");
        if (prefix.isEmpty()) {
            respond(exchange, 404, "not found");
            return;
        }
        List<String> segments = Arrays.stream(raw.substring(prefix.length()).split("/", -1))
                .map(segment -> URLDecoder.decode(segment, StandardCharsets.UTF_8)).toList();
        String command = segments.getFirst();
        List<String> arguments = segments.subList(1, segments.size());
        boolean authenticated = query.containsKey("autht");
        requests.add(new Request("miniserver", command, arguments, authenticated));
        awaitIfHanging(command);
        Integer bareStatus;
        String rawBody;
        synchronized (this) {
            bareStatus = bare.get(command);
            rawBody = rawAnswers.get(command);
        }
        if (rawBody != null) {
            respond(exchange, 200, rawBody);
            return;
        }
        if (bareStatus != null) {
            respond(exchange, bareStatus, "<html><body>" + bareStatus + "</body></html>");
            return;
        }
        Answer answer;
        synchronized (this) {
            answer = switch (prefix) {
                case "/jdev/sys/" -> system(command, arguments, query);
                case "/jdev/cfg/" -> configuration(command);
                default -> sps(command, arguments, query);
            };
        }
        if (answer.headerOnly()) {
            respond(exchange, answer.code(), "<html>" + answer.code() + " " + control + "</html>");
            return;
        }
        ObjectNode envelope = JSON.createObjectNode();
        ObjectNode ll = envelope.putObject("LL");
        ll.put("control", prefix.equals("/jdev/cfg/") ? control.substring(2) : control);
        if (answer.value() != null) {
            ll.set("value", answer.value());
        } else {
            ll.put("value", control);
        }
        ll.put("Code", String.valueOf(answer.code()));
        respond(exchange, 200, envelope.toString());
    }

    private record Answer(int code, @Nullable JsonNode value, boolean headerOnly) {

        static Answer of(int code) {
            return new Answer(code, null, false);
        }

        static Answer header(int code) {
            return new Answer(code, null, true);
        }
    }

    private void awaitIfHanging(String command) {
        boolean hangs;
        synchronized (this) {
            hangs = command.equals(hanging);
        }
        if (hangs) {
            try {
                released.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private Answer system(String command, List<String> arguments, Map<String, String> query) {
        Integer code = forced.get(command);
        if (code != null) {
            return Answer.header(code);
        }
        return switch (command) {
            case "getkey2" -> {
                if (arguments.size() != 1 || !arguments.getFirst().equals(USER)) {
                    yield Answer.header(401);
                }
                pendingKey = HexFormat.of().formatHex(randomBytes(20));
                ObjectNode value = JSON.createObjectNode();
                value.put("key", HexFormat.of().formatHex(pendingKey.getBytes(StandardCharsets.US_ASCII)));
                value.put("salt", salt);
                value.put("hashAlg", hashAlgorithm);
                yield new Answer(200, value, false);
            }
            case "getjwt" -> jwt(arguments);
            case "date" -> new Answer(200, JSON.getNodeFactory().stringNode(
                    LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC).toLocalDate().toString()), false);
            case "time" -> new Answer(200, JSON.getNodeFactory().stringNode(
                    DateTimeFormatter.ofPattern("HH:mm:ss").format(LocalDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))),
                    false);
            case "killtoken" -> {
                String killed = arguments.isEmpty() ? "" : arguments.getFirst();
                if (!killed.equals(query.get("autht")) || !tokens.containsKey(killed)) {
                    yield Answer.header(401);
                }
                tokens.remove(killed);
                yield Answer.of(200);
            }
            default -> Answer.of(404);
        };
    }

    private Answer configuration(String command) {
        if (!command.equals("apiKey")) {
            return Answer.of(404);
        }
        String value = "{'snr': '" + HexFormat.ofDelimiter(":").withUpperCase().formatHex(HexFormat.of()
                .parseHex(SERIAL)) + "', 'version':'" + version + "', 'key':'" + HexFormat.of().formatHex(
                randomBytes(20)) + "', 'isInTrust':0, 'local':false, 'httpsStatus':1}";
        return new Answer(200, JSON.getNodeFactory().stringNode(value), false);
    }

    private Answer jwt(List<String> arguments) {
        String key = pendingKey;
        pendingKey = null;
        if (arguments.size() != 5 || key == null || !arguments.get(1).equals(USER)
                || !arguments.getFirst().equals(expectedHash(key))) {
            return Answer.header(401);
        }
        int permission = Integer.parseInt(arguments.get(2));
        permissions.add(permission);
        clientUuids.add(arguments.get(3));
        int rights = withoutUserManagement ? permission & ~USER_MANAGEMENT : permission;
        rights = withoutChangePassword ? rights & ~CHANGE_PASSWORD : rights;
        String token = "eyJ" + HexFormat.of().formatHex(randomBytes(24));
        long validUntil = loxoneSeconds(clock.instant().plus(tokenLifetime));
        tokens.put(token, new Token(token, USER, validUntil, rights));
        ObjectNode value = JSON.createObjectNode();
        value.put("token", token);
        value.put("key", HexFormat.of().formatHex(randomBytes(20)));
        value.put("validUntil", validUntil);
        value.put("tokenRights", rights);
        value.put("unsecurePass", false);
        return new Answer(200, value, false);
    }

    private String expectedHash(String key) {
        try {
            String digestName = hashAlgorithm.equals("SHA1") ? "SHA-1" : "SHA-256";
            String macName = hashAlgorithm.equals("SHA1") ? "HmacSHA1" : "HmacSHA256";
            String passwordHash = HexFormat.of().withUpperCase().formatHex(MessageDigest.getInstance(digestName)
                    .digest((PASSWORD + ":" + salt).getBytes(StandardCharsets.UTF_8)));
            Mac mac = Mac.getInstance(macName);
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.US_ASCII), macName));
            return HexFormat.of().formatHex(mac.doFinal((USER + ":" + passwordHash)
                    .getBytes(StandardCharsets.UTF_8)));
        } catch (Exception unavailable) {
            throw new IllegalStateException("the simulator could not hash", unavailable);
        }
    }

    private Answer sps(String command, List<String> arguments, Map<String, String> query) {
        Instant now = clock.instant();
        if (lockedUntil != null && now.isBefore(lockedUntil)) {
            return Answer.header(429);
        }
        Token token = tokens.get(query.getOrDefault("autht", ""));
        if (refuseEveryToken || token == null || !token.user().equals(query.get("user"))
                || token.validUntil() <= loxoneSeconds(now)) {
            return Answer.header(401);
        }
        Integer code = forced.get(command);
        if (code != null) {
            return code == 429 || code == 423 ? Answer.header(code) : Answer.of(code);
        }
        if ((token.rights() & USER_MANAGEMENT) == 0) {
            refusals++;
            if (refusals >= 5) {
                lockedUntil = now.plus(Duration.ofMinutes(5));
            }
            return Answer.of(403);
        }
        return switch (command) {
            case "getuserlist2" -> userList();
            case "getgrouplist" -> groupList();
            case "getuser" -> readUser(arguments);
            case "addoredituser" -> addOrEdit(arguments);
            case "deleteuser" -> delete(arguments);
            case "updateuseraccesscode" -> (token.rights() & CHANGE_PASSWORD) == 0 ? Answer.of(403)
                    : accessCode(arguments);
            default -> Answer.of(404);
        };
    }

    private Answer userList() {
        ArrayNode list = JSON.createArrayNode();
        users.values().forEach(user -> {
            ObjectNode entry = list.addObject();
            entry.put("name", user.name);
            entry.put("uuid", user.uuid);
            entry.put("isAdmin", user.admin);
            entry.put("userState", user.userState);
            entry.put("expirationAction", user.expirationAction);
        });
        return new Answer(200, list, false);
    }

    private Answer groupList() {
        ArrayNode list = JSON.createArrayNode();
        groups.values().forEach(group -> {
            ObjectNode entry = list.addObject();
            entry.put("name", group.name());
            entry.put("description", group.name());
            entry.put("uuid", group.uuid());
            entry.put("type", group.type());
            entry.put("userRights", group.type() == 1 ? 4294967295L : 0);
        });
        return new Answer(200, list, false);
    }

    private Answer addOrEdit(List<String> arguments) {
        if (arguments.size() != 1) {
            return Answer.of(500);
        }
        JsonNode json;
        try {
            json = JSON.readTree(arguments.getFirst());
        } catch (RuntimeException malformed) {
            return Answer.of(500);
        }
        if (!json.isObject()) {
            return Answer.of(500);
        }
        String uuid = json.path("uuid").isString() ? json.path("uuid").asString() : null;
        String name = json.path("name").asString("");
        User user;
        if (uuid == null) {
            boolean taken = users.values().stream().anyMatch(existing -> existing.name.equals(name));
            if (taken || nameTakenOnCreate) {
                return Answer.of(400);
            }
            user = null;
        } else {
            user = users.get(uuid);
            if (user == null) {
                return Answer.of(500);
            }
            if (user.admin) {
                return Answer.of(403);
            }
        }
        List<String> assigned = null;
        if (json.has("usergroups")) {
            assigned = new ArrayList<>();
            for (JsonNode group : json.get("usergroups")) {
                Group known = groups.get(group.asString());
                if (known == null) {
                    return Answer.of(404);
                }
                if (known.type() == 1 || known.type() == 4) {
                    return Answer.of(403);
                }
                assigned.add(known.uuid());
            }
        }
        if (user == null) {
            user = add(name, false);
        }
        if (json.has("name")) {
            user.name = renameUsers ? name.substring(0, name.length() - 1) + "_" : name;
        }
        user.userState = json.path("userState").asInt(user.userState);
        user.validFrom = json.path("validFrom").asLong(user.validFrom);
        user.validUntil = json.path("validUntil").asLong(user.validUntil);
        user.expirationAction = json.path("expirationAction").asInt(user.expirationAction);
        user.changePassword = json.path("changePassword").asBoolean(user.changePassword);
        if (assigned != null) {
            user.groups = assigned;
        }
        if (answerAsMember) {
            User member = users.values().stream().filter(other -> other.name.equals("jane.doe")).findFirst()
                    .orElseThrow();
            return new Answer(200, serialized(member), false);
        }
        return new Answer(200, serialized(user), false);
    }

    private Answer readUser(List<String> arguments) {
        User user = arguments.size() == 1 ? users.get(arguments.getFirst()) : null;
        if (user == null) {
            return Answer.of(500);
        }
        ObjectNode read = serialized(user);
        omittedOnReadBack.forEach(read::remove);
        return new Answer(200, read, false);
    }

    private ObjectNode serialized(User user) {
        ObjectNode value = JSON.createObjectNode();
        value.put("name", user.name);
        value.put("uuid", user.uuid);
        value.put("isAdmin", user.admin);
        value.put("changePassword", user.changePassword);
        value.put("userState", user.userState);
        value.put("validFrom", user.validFrom);
        value.put("validUntil", user.validUntil);
        value.put("expirationAction", user.expirationAction);
        ArrayNode assigned = value.putArray("usergroups");
        user.groups.forEach(group -> assigned.addObject().put("uuid", group).put("name", groups.get(group) == null
                ? "" : groups.get(group).name()));
        value.putArray("keycodes");
        return value;
    }

    private Answer delete(List<String> arguments) {
        User user = arguments.size() == 1 ? users.get(arguments.getFirst()) : null;
        if (user == null) {
            return Answer.of(400);
        }
        if (user.admin) {
            return Answer.of(403);
        }
        if (!ignoreDeletes) {
            users.remove(user.uuid);
        }
        return Answer.of(200);
    }

    private Answer accessCode(List<String> arguments) {
        User user = arguments.size() == 2 ? users.get(arguments.getFirst()) : null;
        if (user == null) {
            return Answer.of(400);
        }
        if (vanishBeforeCode) {
            users.remove(user.uuid);
            return Answer.of(400);
        }
        String code = arguments.get(1);
        if (!code.matches("[0-9]{2,8}")) {
            if (failCodeClearing) {
                return Answer.of(500);
            }
            user.code = null;
            return Answer.of(200);
        }
        boolean heldElsewhere = users.values().stream()
                .anyMatch(other -> other != user && code.equals(other.code));
        user.code = code;
        return Answer.of(heldElsewhere ? 201 : 200);
    }

    private void group(String name, int type) {
        String uuid = loxoneUuid();
        groups.put(uuid, new Group(uuid, name, type));
    }

    private User add(String name, boolean admin) {
        User user = new User(loxoneUuid(), name, admin);
        users.put(user.uuid, user);
        return user;
    }

    private static String loxoneUuid() {
        String hex = HexFormat.of().formatHex(randomBytes(16));
        return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-"
                + hex.substring(16);
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    private static Map<String, String> query(@Nullable String raw) {
        Map<String, String> parameters = new HashMap<>();
        if (raw == null) {
            return parameters;
        }
        for (String pair : raw.split("&")) {
            int split = pair.indexOf('=');
            if (split > 0) {
                parameters.put(URLDecoder.decode(pair.substring(0, split), StandardCharsets.UTF_8),
                        URLDecoder.decode(pair.substring(split + 1), StandardCharsets.UTF_8));
            }
        }
        return parameters;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @Override
    public void close() {
        released.countDown();
        cloud.stop(0);
        miniserver.stop(0);
        if (moved != null) {
            moved.stop(0);
        }
        handlers.shutdownNow();
    }
}
