package org.courtside;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.LongAdder;

public class SqlStatementCounter {

    private final Map<String, LongAdder> counts = new ConcurrentHashMap<>();
    private volatile boolean active;
    private volatile long ownerThreadId = -1;

    void record(String sql) {
        if (active && Thread.currentThread().threadId() == ownerThreadId) {
            counts.computeIfAbsent(categoryOf(sql), ignored -> new LongAdder()).increment();
        }
    }

    public void reset() {
        counts.clear();
        ownerThreadId = Thread.currentThread().threadId();
        active = true;
    }

    public void pause() {
        active = false;
        ownerThreadId = -1;
    }

    public Snapshot snapshot() {
        Map<String, Long> categories = new LinkedHashMap<>();
        counts.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> categories.put(entry.getKey(), entry.getValue().sum()));
        return new Snapshot(Map.copyOf(categories));
    }

    private static String categoryOf(String sql) {
        String normalized = sql.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
        if (normalized.contains(" opening_hours")) {
            return "opening-hours";
        }
        if (normalized.contains(" membership_period") || normalized.contains(" member ")) {
            return "membership";
        }
        if (normalized.contains(" rule_definition") || normalized.contains(" rule_set")) {
            return "rule-parameter";
        }
        if (normalized.contains(" court_allocation")) {
            return "court-allocation";
        }
        if (normalized.contains(" booking_participant")) {
            return "booking-participant";
        }
        if (normalized.contains(" booking_series")) {
            return "booking-series";
        }
        if (normalized.contains(" booking_card")) {
            return "booking-card";
        }
        if (normalized.contains(" booking")) {
            return "booking";
        }
        if (normalized.contains(" court")) {
            return "court";
        }
        return "other";
    }

    public record Snapshot(Map<String, Long> categories) {

        public long total() {
            return categories.values().stream().mapToLong(Long::longValue).sum();
        }

        public long category(String name) {
            return categories.getOrDefault(name, 0L);
        }
    }
}
