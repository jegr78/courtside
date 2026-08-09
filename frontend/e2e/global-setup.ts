import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

async function waitForApplication(application: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (application.exitCode !== null) {
      throw new Error(`Courtside stopped with exit code ${application.exitCode}`);
    }
    try {
      const response = await fetch("http://127.0.0.1:18080/actuator/health");
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Courtside did not become ready");
}

async function seedMember(postgres: StartedTestContainer): Promise<void> {
  const sql = `
    INSERT INTO person (id, first_name, last_name, email)
    VALUES ('00000000-0000-0000-0000-000000000101', 'Jane', 'Doe', 'jane.doe@example.org');
    INSERT INTO user_account
      (id, person_id, username, password_hash, locale, enabled, password_change_required)
    SELECT '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000101', 'doe.jane', password_hash, 'en', true, false
    FROM user_account WHERE username = 'bootstrap-admin';
    INSERT INTO user_account_role (user_account_id, role)
    VALUES ('00000000-0000-0000-0000-000000000102', 'MEMBER');
  `;
  const result = await postgres.exec([
    "psql", "-U", "courtside", "-d", "courtside", "-v", "ON_ERROR_STOP=1", "-c", sql
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Could not seed the member account: ${result.stderr}`);
  }
}

function applicationJar(): string {
  const target = resolve("../target");
  const candidates = readdirSync(target)
    .filter((name) => /^courtside-.+\.jar$/.test(name) && !name.endsWith(".jar.original"))
    .map((name) => ({ path: resolve(target, name), modified: statSync(resolve(target, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  if (!candidates[0]) {
    throw new Error("No packaged Courtside application was found");
  }
  return candidates[0].path;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  let postgres: StartedTestContainer | undefined;
  let application: ChildProcess | undefined;
  try {
    postgres = await new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_DB: "courtside",
        POSTGRES_USER: "courtside",
        POSTGRES_PASSWORD: "courtside"
      })
      .withExposedPorts(5432)
      .start();
    const java = process.env.JAVA_HOME ? `${process.env.JAVA_HOME}/bin/java` : "java";
    application = spawn(java, ["-jar", applicationJar()], {
      env: {
        ...process.env,
        SERVER_PORT: "18080",
        SPRING_DATASOURCE_URL: `jdbc:postgresql://${postgres.getHost()}:${postgres.getMappedPort(5432)}/courtside`,
        SPRING_DATASOURCE_USERNAME: "courtside",
        SPRING_DATASOURCE_PASSWORD: "courtside",
        COURTSIDE_COOKIE_SECURE: "false",
        COURTSIDE_BOOTSTRAP_ADMIN_USERNAME: "bootstrap-admin",
        COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD: "temporary-password",
        COURTSIDE_BOOTSTRAP_ADMIN_DISPLAY_NAME: "Bootstrap Administrator"
      },
      stdio: "inherit"
    });
    await waitForApplication(application);
    await seedMember(postgres);
  } catch (error) {
    application?.kill();
    await postgres?.stop();
    throw error;
  }
  return async () => {
    application?.kill();
    await postgres?.stop();
  };
}
