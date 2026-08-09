FROM eclipse-temurin:25-jre

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

USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError", "org.springframework.boot.loader.launch.JarLauncher"]
