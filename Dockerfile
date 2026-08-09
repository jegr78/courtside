FROM eclipse-temurin:25-jre

RUN useradd --system --uid 10001 --user-group --home-dir /app --create-home courtside
WORKDIR /app
USER courtside

ARG LAYERS=build/layers
COPY --chown=courtside:courtside ${LAYERS}/dependencies/ ./
COPY --chown=courtside:courtside ${LAYERS}/spring-boot-loader/ ./
COPY --chown=courtside:courtside ${LAYERS}/snapshot-dependencies/ ./
COPY --chown=courtside:courtside ${LAYERS}/application/ ./

EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "org.springframework.boot.loader.launch.JarLauncher"]
