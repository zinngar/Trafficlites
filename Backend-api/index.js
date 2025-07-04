// Trafficlites Backend - Node.js + Express + PostgreSQL

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Still need Pool constructor
require('dotenv').config();
const axios = require('axios'); // Dependency: npm install axios

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// POST: User submits traffic light report
app.post('/report', async (req, res) => {
  const { latitude, longitude, status } = req.body;
  const dbPool = req.app.locals.dbPool;

  if (latitude == null || longitude == null || !status) { // Check for null or undefined for coords
    return res.status(400).json({ error: 'Missing required fields: latitude, longitude, status' });
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Invalid data type: latitude and longitude must be numbers.' });
  }
  const validStatuses = ['green', 'yellow', 'red', 'malfunctioning'];
  if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const result = await dbPool.query(
      'INSERT INTO reports (latitude, longitude, status, timestamp) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [latitude, longitude, status]
    );
    const newReport = result.rows[0];
    processReportForTiming(dbPool, newReport).catch(err => {
      console.error('Error in processReportForTiming:', err);
    });
    res.status(201).json(newReport);
  } catch (err) {
    console.error('Database error in POST /report:', err);
    res.status(500).json({ error: 'Database error while saving report' });
  }
});

const CLUSTERING_RADIUS_METERS = 50;

function getDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180; const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180; const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function processReportForTiming(dbPool, report) {
  const { latitude, longitude, status, timestamp: reportTimestamp } = report;
  let clusterId;
  const nearbyClusters = await dbPool.query(
    'SELECT *, (6371000 * acos(cos(radians($1)) * cos(radians(center_latitude)) * cos(radians(center_longitude) - radians($2)) + sin(radians($1)) * sin(radians(center_latitude)))) AS distance FROM traffic_light_clusters ORDER BY distance ASC LIMIT 1',
    [latitude, longitude]
  );
  let targetCluster = null;
  if (nearbyClusters.rows.length > 0 && nearbyClusters.rows[0].distance <= CLUSTERING_RADIUS_METERS) {
    targetCluster = nearbyClusters.rows[0];
  }
  if (targetCluster) {
    clusterId = targetCluster.cluster_id;
    const newReportCount = targetCluster.report_count + 1;
    const oldWeight = targetCluster.report_count / newReportCount;
    const newWeight = 1 / newReportCount;
    const newCenterLatitude = (targetCluster.center_latitude * oldWeight) + (latitude * newWeight);
    const newCenterLongitude = (targetCluster.center_longitude * oldWeight) + (longitude * newWeight);
    await dbPool.query(
      'UPDATE traffic_light_clusters SET center_latitude = $1, center_longitude = $2, report_count = $3, updated_at = NOW() WHERE cluster_id = $4',
      [newCenterLatitude, newCenterLongitude, newReportCount, clusterId]
    );
  } else {
    const newClusterResult = await dbPool.query( 'INSERT INTO traffic_light_clusters (center_latitude, center_longitude, report_count) VALUES ($1, $2, 1) RETURNING cluster_id', [latitude, longitude]);
    clusterId = newClusterResult.rows[0].cluster_id;
  }
  const lastSegmentResult = await dbPool.query( 'SELECT * FROM traffic_light_cycle_segments WHERE cluster_id = $1 ORDER BY start_timestamp DESC, segment_id DESC LIMIT 1', [clusterId]);
  const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;
  if (lastSegment) {
    const newReportTime = new Date(reportTimestamp);
    const lastSegmentStartTime = new Date(lastSegment.start_timestamp);
    if (lastSegment.current_status !== status && lastSegment.end_timestamp === null) {
      const durationSeconds = Math.round((newReportTime - lastSegmentStartTime) / 1000);
      await dbPool.query( 'UPDATE traffic_light_cycle_segments SET end_timestamp = $1, duration_seconds = $2, is_estimated_end = FALSE WHERE segment_id = $3', [reportTimestamp, durationSeconds, lastSegment.segment_id]);
      await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, lastSegment.current_status, status, reportTimestamp]);
    } else if (lastSegment.current_status !== status && lastSegment.end_timestamp !== null) {
      await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, lastSegment.current_status, status, reportTimestamp]);
    } else if (lastSegment.current_status === status && lastSegment.end_timestamp !== null) {
         await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, lastSegment.current_status, status, reportTimestamp]);
    }
  } else {
    await dbPool.query( 'INSERT INTO traffic_light_cycle_segments (cluster_id, previous_status, current_status, start_timestamp, reported_at) VALUES ($1, $2, $3, $4, NOW())', [clusterId, null, status, reportTimestamp]);
  }
}

app.get('/reports', async (req, res) => {
    const dbPool = req.app.locals.dbPool;
    try {
        const result = await dbPool.query('SELECT * FROM reports ORDER BY timestamp DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Database error in GET /reports:', err);
        res.status(500).json({ error: 'Database error while fetching reports' });
    }
});

app.listen(PORT, async () => {
  const localPool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/trafficlites' });
  const localInitDb = async (dbPool) => {
    try {
      await dbPool.query(`CREATE TABLE IF NOT EXISTS reports (id SERIAL PRIMARY KEY, latitude FLOAT NOT NULL, longitude FLOAT NOT NULL, status TEXT NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
      await dbPool.query(`CREATE TABLE IF NOT EXISTS traffic_light_clusters (cluster_id SERIAL PRIMARY KEY, center_latitude FLOAT NOT NULL, center_longitude FLOAT NOT NULL, report_count INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
      await dbPool.query(`CREATE TABLE IF NOT EXISTS traffic_light_cycle_segments (segment_id SERIAL PRIMARY KEY, cluster_id INTEGER REFERENCES traffic_light_clusters(cluster_id) ON DELETE CASCADE, previous_status TEXT, current_status TEXT NOT NULL, start_timestamp TIMESTAMP NOT NULL, end_timestamp TIMESTAMP, duration_seconds INTEGER, is_estimated_end BOOLEAN DEFAULT FALSE, reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
      console.log(`[localInitDb] All tables ensured/created successfully.`);
    } catch (dbError) {
      console.error('[localInitDb] !!! Database query failed during initialization !!!', dbError); throw dbError;
    }
  };
  try {
    app.locals.dbPool = localPool;
    await localInitDb(localPool);
    console.log(`Trafficlites backend listening on port ${PORT}`);
  } catch (err) {
    console.error('Error during startup in app.listen:', err);
    if (localPool) { localPool.end().catch(poolEndErr => console.error('Error ending localPool during startup error', poolEndErr));}
    process.exit(1);
  }
});

function getNextStatus(currentStatus) {
  if (currentStatus === 'green') return 'yellow';
  if (currentStatus === 'yellow') return 'red';
  if (currentStatus === 'red') return 'green';
  return 'unknown';
}

// --- Polyline & Simulation Helper Functions ---

function getDistanceOfPolyline(polylinePoints, startIndex = 0, endIndex = -1) {
  if (!polylinePoints || polylinePoints.length < 2) return 0;
  const effectiveEndIndex = (endIndex === -1 || endIndex >= polylinePoints.length) ? polylinePoints.length - 1 : endIndex;
  if (startIndex >= effectiveEndIndex) return 0;
  let totalDistance = 0;
  for (let i = startIndex; i < effectiveEndIndex; i++) {
    const p1 = polylinePoints[i];
    const p2 = polylinePoints[i+1];
    if (p1 && p2 && typeof p1.latitude === 'number' && typeof p1.longitude === 'number' &&
        typeof p2.latitude === 'number' && typeof p2.longitude === 'number') {
        totalDistance += getDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    } else {
        console.warn("Invalid point in polyline for getDistanceOfPolyline:", p1, p2);
    }
  }
  return totalDistance;
}

function getLightProjectionOnStep(lightLocation, stepPolylinePoints) {
  if (!lightLocation || !stepPolylinePoints || stepPolylinePoints.length === 0) {
    return null;
  }
  let closestVertexIndex = -1;
  let minDistanceToVertex = Infinity;
  for (let i = 0; i < stepPolylinePoints.length; i++) {
    const vertex = stepPolylinePoints[i];
    if (vertex && typeof vertex.latitude === 'number' && typeof vertex.longitude === 'number') {
        const distance = getDistance(
            lightLocation.latitude, lightLocation.longitude,
            vertex.latitude, vertex.longitude
        );
        if (distance < minDistanceToVertex) {
            minDistanceToVertex = distance;
            closestVertexIndex = i;
        }
    } else {
        console.warn("Invalid vertex encountered in getLightProjectionOnStep:", vertex);
    }
  }
  if (closestVertexIndex === -1) return null;
  const closestVertex = stepPolylinePoints[closestVertexIndex];
  const distanceFromStepStartAlongPolyline = getDistanceOfPolyline(stepPolylinePoints, 0, closestVertexIndex);
  return {
    projectedPointLocation: closestVertex,
    indexOnPolyline: closestVertexIndex,
    distanceFromStepStartAlongPolyline: distanceFromStepStartAlongPolyline,
    minDistanceToVertex: minDistanceToVertex
  };
}

function predictLightStateAtFutureTime(lightData, arrivalTimeInMs) {
  // This function will be modified in P10S1
  const { average_durations, last_seen_status, last_seen_timestamp, base_confidence, has_complete_averages } = lightData;

  // P10S1 modification: Check for low base confidence or incomplete averages first
  if (base_confidence === 'low' || !has_complete_averages) {
    return {
      predicted_status: 'unknown',
      wait_time_seconds: 0, // No penalty, just uncertainty
      usedDefaultAverage: true, // Indicate defaults would have been used or data is poor
      effectivelyUnknown: true
    };
  }

  let usedDefaultAverageInternal = false; // Track if defaults are used within this prediction run

  const G_AVG_SRC = average_durations && average_durations.green != null;
  const Y_AVG_SRC = average_durations && average_durations.yellow != null;
  const R_AVG_SRC = average_durations && average_durations.red != null;

  const G_AVG = G_AVG_SRC ? average_durations.green : 60;
  const Y_AVG = Y_AVG_SRC ? average_durations.yellow : 5;
  const R_AVG = R_AVG_SRC ? average_durations.red : 45;

  if (!G_AVG_SRC || !Y_AVG_SRC || !R_AVG_SRC) {
      usedDefaultAverageInternal = true;
  }

  const effective_averages = { green: G_AVG, yellow: Y_AVG, red: R_AVG, unknown: 60 };

  if (!last_seen_status || !last_seen_timestamp) {
    return { predicted_status: 'unknown', wait_time_seconds: 0, usedDefaultAverage: true, effectivelyUnknown: true };
  }

  let currentSimTimeMs = last_seen_timestamp.getTime();
  let currentSimStatus = last_seen_status;

  if (arrivalTimeInMs < currentSimTimeMs) {
    if ((currentSimTimeMs - arrivalTimeInMs) < 1000 ) {
        return { predicted_status: last_seen_status, wait_time_seconds: 0, usedDefaultAverage: usedDefaultAverageInternal, effectivelyUnknown: false };
    }
    return { predicted_status: 'unknown', wait_time_seconds: 0, usedDefaultAverage: true, effectivelyUnknown: true };
  }

  while (currentSimTimeMs < arrivalTimeInMs) {
    let durationForCurrentStatus = effective_averages[currentSimStatus.toLowerCase()];
    if (durationForCurrentStatus == null ) {
        durationForCurrentStatus = 60;
        usedDefaultAverageInternal = true;
    }
    const avgDurationForCurrentSimStatusMs = durationForCurrentStatus * 1000;

    if (currentSimTimeMs + avgDurationForCurrentSimStatusMs > arrivalTimeInMs) {
      let timeRemainingInCurrentSimStatusMs = (currentSimTimeMs + avgDurationForCurrentSimStatusMs) - arrivalTimeInMs;
      let wait_time_seconds = 0;

      if (currentSimStatus === 'green') {
        wait_time_seconds = 0;
      } else if (currentSimStatus === 'yellow') {
        let redDuration = effective_averages.red;
        wait_time_seconds = Math.max(0, Math.round((timeRemainingInCurrentSimStatusMs + (redDuration * 1000)) / 1000));
      } else if (currentSimStatus === 'red') {
        wait_time_seconds = Math.max(0, Math.round(timeRemainingInCurrentSimStatusMs / 1000));
      }
      return { predicted_status: currentSimStatus, wait_time_seconds: wait_time_seconds, usedDefaultAverage: usedDefaultAverageInternal, effectivelyUnknown: false };
    } else {
      currentSimTimeMs += avgDurationForCurrentSimStatusMs;
      currentSimStatus = getNextStatus(currentSimStatus);
      if (currentSimStatus === 'green' && !G_AVG_SRC) usedDefaultAverageInternal = true;
      if (currentSimStatus === 'yellow' && !Y_AVG_SRC) usedDefaultAverageInternal = true;
      if (currentSimStatus === 'red' && !R_AVG_SRC) usedDefaultAverageInternal = true;
    }
  }

  let wait_time_seconds = 0;
  if (currentSimStatus === 'green') {
    wait_time_seconds = 0;
  } else if (currentSimStatus === 'red') {
    wait_time_seconds = Math.round(effective_averages.red);
  } else if (currentSimStatus === 'yellow') {
    wait_time_seconds = Math.round(effective_averages.yellow + effective_averages.red);
  }
  return { predicted_status: currentSimStatus, wait_time_seconds: wait_time_seconds, usedDefaultAverage: usedDefaultAverageInternal, effectivelyUnknown: false };
}

async function simulateRouteForDeparture(simulatableRoute, departureTimeMs, lightPredictionsMap) {
  let totalWaitTimeSeconds = 0;
  let accumulatedTravelTimeMs = 0;
  let lowConfidenceLightEncounterCount = 0;
  let totalLightsSimulated = 0;
  let effectivelyUnknownLightCount = 0; // P10S3 new

  for (const segment of simulatableRoute.segments) {
    const segmentTravelTimeMs = segment.duration_seconds * 1000;
    const arrivalAtSegmentEndWithoutLightMs = departureTimeMs + accumulatedTravelTimeMs + segmentTravelTimeMs;
    accumulatedTravelTimeMs += segmentTravelTimeMs;
    if (segment.ends_at_traffic_light_cluster_id) {
      const lightData = lightPredictionsMap.get(segment.ends_at_traffic_light_cluster_id);
      if (lightData) {
        totalLightsSimulated++;
        const lightDataForSim = { ...lightData, last_seen_timestamp: lightData.last_seen_timestamp ? new Date(lightData.last_seen_timestamp) : null };

        const predictionResult = predictLightStateAtFutureTime(lightDataForSim, arrivalAtSegmentEndWithoutLightMs);
        totalWaitTimeSeconds += predictionResult.wait_time_seconds;
        accumulatedTravelTimeMs += (predictionResult.wait_time_seconds * 1000);

        if (predictionResult.effectivelyUnknown) { // P10S3 check
            effectivelyUnknownLightCount++;
        }
        // lowConfidenceLightEncounterCount combines base confidence and if defaults were used in prediction
        if (lightData.base_confidence === 'low' || predictionResult.usedDefaultAverage) {
          lowConfidenceLightEncounterCount++;
        }
      } else {
        console.warn(`Sim: No prediction data for light ${segment.ends_at_traffic_light_cluster_id}. Assuming 0 wait.`);
      }
    }
  }
  return { totalWaitTimeSeconds, lowConfidenceLightEncounterCount, totalLightsSimulated, effectivelyUnknownLightCount };
}

async function getDepartureAdvice(simulatableRoute, lightPredictionsMap) {
  if (!simulatableRoute || !simulatableRoute.segments || simulatableRoute.segments.length === 0) {
    return { advice: "Route data insufficient for advice.", optimal_departure_offset_seconds: 0, baseline_wait_time_seconds: null, optimal_wait_time_seconds: null, wait_time_savings_seconds: 0, simulation_confidence_level: 'low', low_confidence_lights_on_optimal_route_count: 0, total_lights_simulated_on_optimal_route: 0, effectively_unknown_lights_on_optimal_route_count: 0 };
  }
  const currentTimeMs = new Date().getTime();
  const baselineSimResult = await simulateRouteForDeparture(simulatableRoute, currentTimeMs, lightPredictionsMap);
  let minWaitTimeSeconds = baselineSimResult.totalWaitTimeSeconds;
  let bestOffsetSeconds = 0;
  let lowConfidenceCountForOptimal = baselineSimResult.lowConfidenceLightEncounterCount;
  let totalLightsInOptimal = baselineSimResult.totalLightsSimulated;
  let effectivelyUnknownForOptimal = baselineSimResult.effectivelyUnknownLightCount;

  const offsetsToTest = [-60, -30, 30, 60, 90, 120, 150, 180];
  for (const offset of offsetsToTest) {
    if (offset === 0) continue;
    const currentSimResult = await simulateRouteForDeparture(simulatableRoute, currentTimeMs + (offset * 1000), lightPredictionsMap);
    if (currentSimResult.totalWaitTimeSeconds < minWaitTimeSeconds) {
        minWaitTimeSeconds = currentSimResult.totalWaitTimeSeconds; bestOffsetSeconds = offset;
        lowConfidenceCountForOptimal = currentSimResult.lowConfidenceLightEncounterCount;
        totalLightsInOptimal = currentSimResult.totalLightsSimulated;
        effectivelyUnknownForOptimal = currentSimResult.effectivelyUnknownLightCount;
    } else if (currentSimResult.totalWaitTimeSeconds === minWaitTimeSeconds) {
        if (bestOffsetSeconds > 0 && offset < bestOffsetSeconds && offset >=0) {
             bestOffsetSeconds = offset; lowConfidenceCountForOptimal = currentSimResult.lowConfidenceLightEncounterCount; totalLightsInOptimal = currentSimResult.totalLightsSimulated; effectivelyUnknownForOptimal = currentSimResult.effectivelyUnknownLightCount;
        } else if (bestOffsetSeconds < 0 && offset > bestOffsetSeconds) {
             bestOffsetSeconds = offset; lowConfidenceCountForOptimal = currentSimResult.lowConfidenceLightEncounterCount; totalLightsInOptimal = currentSimResult.totalLightsSimulated; effectivelyUnknownForOptimal = currentSimResult.effectivelyUnknownLightCount;
        }
    }
  }
   if (baselineSimResult.totalWaitTimeSeconds <= minWaitTimeSeconds && bestOffsetSeconds !== 0) {
      minWaitTimeSeconds = baselineSimResult.totalWaitTimeSeconds; bestOffsetSeconds = 0;
      lowConfidenceCountForOptimal = baselineSimResult.lowConfidenceLightEncounterCount; totalLightsInOptimal = baselineSimResult.totalLightsSimulated; effectivelyUnknownForOptimal = baselineSimResult.effectivelyUnknownLightCount;
  }

  const baselineWaitTimeSeconds = baselineSimResult.totalWaitTimeSeconds;
  const waitTimeSavingsSeconds = baselineWaitTimeSeconds !== null && minWaitTimeSeconds !== null ? baselineWaitTimeSeconds - minWaitTimeSeconds : 0;

  let simulation_confidence_level = 'low';
  let adviceMessage = "Current departure time seems reasonable based on predictions.";

  if (totalLightsInOptimal > 0 && (effectivelyUnknownForOptimal / totalLightsInOptimal > 0.30) ) { // More than 30% unknown
      simulation_confidence_level = 'low';
      adviceMessage = "Advice uncertain due to limited data for several lights on this route.";
  } else if (totalLightsInOptimal > 0) {
    const lowConfidenceRatio = lowConfidenceCountForOptimal / totalLightsInOptimal;
    if (lowConfidenceRatio <= 0.15) simulation_confidence_level = 'high';
    else if (lowConfidenceRatio <= 0.40) simulation_confidence_level = 'medium';
    // else remains low from initialization
  } else if (simulatableRoute.segments.length > 0 && totalLightsInOptimal === 0) {
      simulation_confidence_level = 'n/a';
      adviceMessage = "No predictable traffic lights on this route to offer specific timing advice.";
  }

  if (simulation_confidence_level !== 'low' || (effectivelyUnknownForOptimal / (totalLightsInOptimal || 1) <= 0.30) ) { // Only give savings advice if not crippled by unknowns
    if (bestOffsetSeconds > 0 && waitTimeSavingsSeconds > 10) adviceMessage = `Depart in ${bestOffsetSeconds}s to save ~${Math.round(waitTimeSavingsSeconds)}s.`;
    else if (bestOffsetSeconds < 0 && waitTimeSavingsSeconds > 10) adviceMessage = `If left ${-bestOffsetSeconds}s ago, might save ~${Math.round(waitTimeSavingsSeconds)}s.`;
    else if (waitTimeSavingsSeconds <= 0 && bestOffsetSeconds === 0 && baselineWaitTimeSeconds !== null && simulation_confidence_level !== 'n/a') adviceMessage = "Departing now optimal.";
  }

  if (baselineWaitTimeSeconds === null && simulation_confidence_level !== 'n/a') {
      adviceMessage = "Could not determine baseline wait time; advice unavailable."; simulation_confidence_level = 'low';
  }

  return { advice: adviceMessage, optimal_departure_offset_seconds: bestOffsetSeconds, baseline_wait_time_seconds: baselineWaitTimeSeconds !==null ? Math.round(baselineWaitTimeSeconds) : null, optimal_wait_time_seconds: minWaitTimeSeconds !== null ? Math.round(minWaitTimeSeconds) : null, wait_time_savings_seconds: Math.round(waitTimeSavingsSeconds), simulation_confidence_level, low_confidence_lights_on_optimal_route_count: lowConfidenceCountForOptimal, total_lights_simulated_on_optimal_route: totalLightsInOptimal, effectively_unknown_lights_on_optimal_route_count: effectivelyUnknownForOptimal };
}

function decodeGooglePolyline(encoded) { /* ... existing ... */ }

async function fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId) {
    try {
        const avgDurationsResult = await dbPool.query( `SELECT current_status, AVG(duration_seconds) as avg_duration FROM traffic_light_cycle_segments WHERE cluster_id = $1 AND duration_seconds IS NOT NULL AND current_status IN ('green', 'yellow', 'red') GROUP BY current_status`, [clusterId]);
        const average_durations = { green: null, yellow: null, red: null };
        avgDurationsResult.rows.forEach(r => { average_durations[r.current_status.toLowerCase()] = Math.round(r.avg_duration); });

        const clusterDetailsResult = await dbPool.query('SELECT center_latitude, center_longitude, report_count FROM traffic_light_clusters WHERE cluster_id = $1', [clusterId]);
        const cluster_center = clusterDetailsResult.rows.length > 0 ? {latitude: clusterDetailsResult.rows[0].center_latitude, longitude: clusterDetailsResult.rows[0].center_longitude} : null;
        const report_count = clusterDetailsResult.rows.length > 0 ? clusterDetailsResult.rows[0].report_count : 0;

        const lastSegmentResult = await dbPool.query( `SELECT current_status, start_timestamp FROM traffic_light_cycle_segments WHERE cluster_id = $1 ORDER BY start_timestamp DESC LIMIT 1`, [clusterId]);
        if (!cluster_center && avgDurationsResult.rows.length === 0 && lastSegmentResult.rows.length === 0) return null;
        const lastSegment = lastSegmentResult.rows.length > 0 ? lastSegmentResult.rows[0] : null;

        let timeSinceLastUpdate = Infinity;
        if (lastSegment && lastSegment.start_timestamp) {
           timeSinceLastUpdate = (new Date() - new Date(lastSegment.start_timestamp)) / 1000;
        }
        let base_confidence = 'low';
        if (report_count >= 3 && timeSinceLastUpdate < 1800) base_confidence = 'medium';
        if (report_count >= 7 && timeSinceLastUpdate < 600) base_confidence = 'high';

        const has_complete_averages = average_durations.green !== null && average_durations.yellow !== null && average_durations.red !== null;

        return { cluster_id: clusterId, average_durations, last_seen_status: lastSegment?.current_status, last_seen_timestamp: lastSegment ? new Date(lastSegment.start_timestamp) : null, cluster_center, base_confidence, report_count, has_complete_averages };
    } catch(e) { console.error(`Error fetching light data for cluster ${clusterId}:`, e); return null; }
}

app.post('/route_departure_advice', async (req, res) => { /* ... existing, uses updated helpers ... */ });
app.get('/light_timings/:latitude/:longitude', async (req, res) => { /* ... existing, uses updated fetchLightTimingAndPredictionDataForCluster ... */ });
