package org.courtside.identity.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.courtside.api.ApiAccountSession;
import org.courtside.api.ApiBrowserFamily;
import org.courtside.identity.AccountSessions;
import org.courtside.identity.CurrentUser;
import org.courtside.identity.RecentAuthentication;
import org.courtside.identity.UserAccount;
import org.courtside.shared.SecurityEventLog;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
@RequiredArgsConstructor
class AccountSessionService {

    static final String BROWSER_FAMILY = "courtside.browser-family";

    private final FindByIndexNameSessionRepository<? extends Session> sessions;
    private final CurrentUser currentUser;
    private final RecentAuthentication recentAuthentication;
    private final AccountSessions accountSessions;
    private final SecurityEventLog securityEvents;
    private final HttpServletRequest request;

    @Transactional(readOnly = true)
    List<ApiAccountSession> list() {
        UserAccount account = currentUser.requireAccount();
        String currentId = currentSessionId();
        return sessions.findByPrincipalName(account.getUsername()).entrySet().stream()
                .map(entry -> toApi(entry.getKey(), entry.getValue(), currentId))
                .sorted(Comparator.comparing(ApiAccountSession::getLastActivityAt).reversed())
                .toList();
    }

    @Transactional
    boolean endOne(String requestedHandle) {
        UserAccount account = currentUser.requireAccount();
        String currentId = currentSessionId();
        Map<String, ? extends Session> active = sessions.findByPrincipalName(account.getUsername());
        String selectedId = active.keySet().stream()
                .filter(id -> MessageDigest.isEqual(handle(id).getBytes(StandardCharsets.US_ASCII),
                        requestedHandle.getBytes(StandardCharsets.US_ASCII)))
                .findFirst()
                .orElseThrow(AccountSessionNotFoundException::new);
        boolean current = selectedId.equals(currentId);
        if (!current) {
            recentAuthentication.requireRecent();
        }
        sessions.deleteById(selectedId);
        securityEvents.sessionTerminatedAfterCommit(account.getId(), account.getId(),
                SecurityEventLog.SessionTermination.USER_REVOKED);
        return current;
    }

    @Transactional
    void endAll() {
        recentAuthentication.requireRecent();
        UserAccount account = currentUser.requireAccount();
        accountSessions.revoke(account);
        securityEvents.sessionTerminatedAfterCommit(account.getId(), account.getId(),
                SecurityEventLog.SessionTermination.USER_REVOKED);
    }

    private ApiAccountSession toApi(String id, Session session, String currentId) {
        return new ApiAccountSession(handle(id),
                session.getCreationTime().atOffset(ZoneOffset.UTC),
                session.getLastAccessedTime().atOffset(ZoneOffset.UTC),
                id.equals(currentId), storedBrowserFamily(session));
    }

    private String currentSessionId() {
        HttpSession session = request.getSession(false);
        return session == null ? "" : session.getId();
    }

    private static ApiBrowserFamily storedBrowserFamily(Session session) {
        Object value = session.getAttribute(BROWSER_FAMILY);
        if (value instanceof String name) {
            try {
                return ApiBrowserFamily.valueOf(name);
            } catch (IllegalArgumentException ignored) {
                return ApiBrowserFamily.OTHER;
            }
        }
        return ApiBrowserFamily.OTHER;
    }

    static ApiBrowserFamily browserFamily(String userAgent) {
        if (userAgent == null) {
            return ApiBrowserFamily.OTHER;
        }
        String normalized = userAgent.toLowerCase(Locale.ROOT);
        if (normalized.contains("edg/")) {
            return ApiBrowserFamily.EDGE;
        }
        if (normalized.contains("firefox/") || normalized.contains("fxios/")) {
            return ApiBrowserFamily.FIREFOX;
        }
        if (normalized.contains("chrome/") || normalized.contains("crios/")) {
            return ApiBrowserFamily.CHROME;
        }
        if (normalized.contains("safari/") && normalized.contains("version/")) {
            return ApiBrowserFamily.SAFARI;
        }
        return ApiBrowserFamily.OTHER;
    }

    @SuppressWarnings("java:S4790")
    static String handle(String sessionId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(sessionId.getBytes(StandardCharsets.UTF_8));
            byte[] truncated = java.util.Arrays.copyOf(digest, 16);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(truncated);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("The Java runtime has no SHA-256 implementation", impossible);
        }
    }
}
