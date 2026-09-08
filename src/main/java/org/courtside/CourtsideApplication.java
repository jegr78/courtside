package org.courtside;

import org.courtside.shared.DatabaseMigration;
import org.courtside.shared.DatabaseProvisioning;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.modulith.Modulithic;

@Modulithic(systemName = "Courtside", sharedModules = {"api", "shared"})
@SpringBootApplication
public class CourtsideApplication {

    public static void main(String[] args) {
        if (DatabaseProvisioning.requested(args)) {
            DatabaseProvisioning.provision(System.getenv());
            return;
        }
        if (DatabaseMigration.requested(args)) {
            DatabaseMigration.migrate(System.getenv());
            return;
        }
        SpringApplication.run(CourtsideApplication.class, args);
    }
}
