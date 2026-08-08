package org.courtside;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.modulith.Modulithic;

@Modulithic(systemName = "Courtside", sharedModules = "shared")
@SpringBootApplication
public class CourtsideApplication {

    public static void main(String[] args) {
        SpringApplication.run(CourtsideApplication.class, args);
    }
}
