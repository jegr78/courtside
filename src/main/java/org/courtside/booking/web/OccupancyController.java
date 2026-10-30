package org.courtside.booking.web;

import lombok.RequiredArgsConstructor;
import org.courtside.api.OccupancyApi;
import org.courtside.booking.internal.OccupancyKeys;
import org.courtside.booking.internal.OccupancySignal;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
class OccupancyController implements OccupancyApi {

    private final OccupancyKeys keys;
    private final OccupancySignal signal;

    @Override
    public ResponseEntity<String> getCourtOccupancy(String key) {
        if (!keys.accepts(key)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        StringBuilder body = new StringBuilder();
        for (OccupancySignal.CourtSignal court : signal.read()) {
            body.append("court").append(court.courtNumber()).append(".occupied=").append(court.occupied() ? 1 : 0)
                    .append('\n')
                    .append("court").append(court.courtNumber()).append(".minutes=").append(court.minutes())
                    .append('\n');
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body.toString());
    }
}
