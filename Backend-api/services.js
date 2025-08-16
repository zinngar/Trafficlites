// --- Constants ---
const MAX_PROJECTION_CYCLES = 10;
const CLUSTERING_RADIUS_METERS = 50;
const DEFAULT_DURATIONS = {
    green: 60,
    yellow: 5,
    red: 45,
    unknown: 60,
};

// --- Helper Functions ---

/**
 * Calculates the distance between two lat/lon coordinates in meters.
 */
function getDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
    const R = 6371e3; // Earth radius in meters
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Determines the next traffic light status in a typical cycle.
 */
function getNextStatus(currentStatus) {
    const sequence = { green: 'yellow', yellow: 'red', red: 'green' };
    return sequence[currentStatus] || 'unknown';
}

/**
 * Predicts the state of a traffic light at a specific future time.
 * This is a simplified reconstruction of the complex logic in the original file.
 */
function predictLightStateAtFutureTime(lightData, arrivalTimeInMs) {
    const {
        average_durations,
        last_seen_status,
        last_seen_timestamp,
        base_confidence,
        has_complete_averages
    } = lightData;

    const confidence = base_confidence === 'high' && has_complete_averages ? 0.9 : 0.5;

    if (base_confidence === 'low' || !has_complete_averages) {
        return {
            predicted_current_status: 'unknown',
            predicted_time_remaining_seconds: 0,
            prediction_confidence: confidence,
        };
    }

    const effective_averages = {
        green: average_durations.green ?? DEFAULT_DURATIONS.green,
        yellow: average_durations.yellow ?? DEFAULT_DURATIONS.yellow,
        red: average_durations.red ?? DEFAULT_DURATIONS.red,
    };

    if (!last_seen_status || !last_seen_timestamp) {
        return {
            predicted_current_status: 'unknown',
            predicted_time_remaining_seconds: 0,
            prediction_confidence: 0.2,
        };
    }

    let currentSimTimeMs = new Date(last_seen_timestamp).getTime();
    let currentSimStatus = last_seen_status;

    if (arrivalTimeInMs < currentSimTimeMs) {
        return {
            predicted_current_status: 'unknown',
            predicted_time_remaining_seconds: 0,
            prediction_confidence: 0.3,
        };
    }

    let simulatedCycleCount = 0;
    const fullCycleLengthMs = (effective_averages.green + effective_averages.yellow + effective_averages.red) * 1000;

    // Fast-forward through full cycles
    if (fullCycleLengthMs > 0) {
        const timeDiffMs = arrivalTimeInMs - currentSimTimeMs;
        const cyclesToSkip = Math.floor(timeDiffMs / fullCycleLengthMs);
        if (cyclesToSkip > 0) {
            currentSimTimeMs += cyclesToSkip * fullCycleLengthMs;
            simulatedCycleCount += cyclesToSkip;
        }
    }

    while (currentSimTimeMs < arrivalTimeInMs && simulatedCycleCount <= MAX_PROJECTION_CYCLES) {
        const durationForCurrentStatusMs = (effective_averages[currentSimStatus] || DEFAULT_DURATIONS.unknown) * 1000;

        if (currentSimTimeMs + durationForCurrentStatusMs > arrivalTimeInMs) {
            // Arrival is within the current status duration
            const timeIntoStatusMs = arrivalTimeInMs - currentSimTimeMs;
            const timeRemainingMs = durationForCurrentStatusMs - timeIntoStatusMs;
            let time_remaining_seconds = timeRemainingMs / 1000;

            return {
                predicted_current_status: currentSimStatus,
                predicted_time_remaining_seconds: Math.round(time_remaining_seconds),
                prediction_confidence: confidence,
            };
        }

        currentSimTimeMs += durationForCurrentStatusMs;
        const prevStatus = currentSimStatus;
        currentSimStatus = getNextStatus(currentSimStatus);
        if (prevStatus === 'red' && currentSimStatus === 'green') {
            simulatedCycleCount++;
        }
    }

    // If simulation ends or exceeds max cycles, return unknown
    return {
        predicted_current_status: 'unknown',
        predicted_time_remaining_seconds: 0,
        prediction_confidence: 0.4, // Low confidence if we had to loop too much
    };
}


module.exports = {
    getDistance,
    getNextStatus,
    predictLightStateAtFutureTime,
    CLUSTERING_RADIUS_METERS,
};
