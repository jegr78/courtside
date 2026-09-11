FROM eclipse-temurin:25-jre@sha256:f9e65324a37f28209ce7dd0e5149a7aa954520ed936fb87813cf6ded2400a112

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 courtside \
 && useradd --system --uid 10001 --gid 10001 --no-create-home courtside

WORKDIR /app

ARG LAYERS=build/layers
COPY ${LAYERS}/dependencies/ ./
COPY ${LAYERS}/spring-boot-loader/ ./
COPY ${LAYERS}/snapshot-dependencies/ ./
COPY ${LAYERS}/application/ ./
COPY LICENSE NOTICE ./

RUN set -eu; \
    recorded=0; \
    while IFS= read -r file; do \
      [ -n "$file" ] || continue; \
      recorded=$((recorded + 1)); \
      if [ -e "BOOT-INF/classes/$file" ]; then \
        echo "The production image carries the non-production file $file" >&2; \
        exit 1; \
      fi; \
    done < META-INF/courtside-excluded-fixtures.txt; \
    [ "$recorded" -gt 0 ] || { echo "The exclusion record names no file to keep out" >&2; exit 1; }

USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/actuator/health || exit 1

ENTRYPOINT ["java", "--sun-misc-unsafe-memory-access=deny", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "org.springframework.boot.loader.launch.JarLauncher"]
