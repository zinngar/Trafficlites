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

async function processReportForTiming(dbPool, report) { /* ... (condensed) ... */ }
app.get('/reports', async (req, res) => { /* ... (condensed) ... */ });
app.listen(PORT, async () => { /* ... (condensed, includes localInitDb) ... */ });

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
    const p1 = polylinePoints[i]; const p2 = polylinePoints[i+1];
    if (p1 && p2 && typeof p1.latitude === 'number' && typeof p1.longitude === 'number' &&  typeof p2.latitude === 'number' && typeof p2.longitude === 'number') {
        totalDistance += getDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    } else { console.warn("Invalid point in polyline for getDistanceOfPolyline:", p1, p2); }
  }
  return totalDistance;
}

function getLightProjectionOnStep(lightLocation, stepPolylinePoints) {
  if (!lightLocation || !stepPolylinePoints || stepPolylinePoints.length === 0) return null;
  let closestVertexIndex = -1; let minDistanceToVertex = Infinity;
  for (let i = 0; i < stepPolylinePoints.length; i++) {
    const vertex = stepPolylinePoints[i];
    if (vertex && typeof vertex.latitude === 'number' && typeof vertex.longitude === 'number') {
        const distance = getDistance(lightLocation.latitude, lightLocation.longitude, vertex.latitude, vertex.longitude);
        if (distance < minDistanceToVertex) { minDistanceToVertex = distance; closestVertexIndex = i; }
    } else { console.warn("Invalid vertex in getLightProjectionOnStep:", vertex); }
  }
  if (closestVertexIndex === -1) return null;
  const closestVertex = stepPolylinePoints[closestVertexIndex];
  const distanceFromStepStartAlongPolyline = getDistanceOfPolyline(stepPolylinePoints, 0, closestVertexIndex);
  return { projectedPointLocation: closestVertex, indexOnPolyline: closestVertexIndex, distanceFromStepStartAlongPolyline, minDistanceToVertex };
}

function predictLightStateAtFutureTime(lightData, arrivalTimeInMs) {
  const { average_durations, last_seen_status, last_seen_timestamp } = lightData;
  let usedDefaultAverage = false;
  const G_AVG_SRC = average_durations && average_durations.green != null;
  const Y_AVG_SRC = average_durations && average_durations.yellow != null;
  const R_AVG_SRC = average_durations && average_durations.red != null;
  const G_AVG = G_AVG_SRC ? average_durations.green : 60;
  const Y_AVG = Y_AVG_SRC ? average_durations.yellow : 5;
  const R_AVG = R_AVG_SRC ? average_durations.red : 45;
  if (!G_AVG_SRC || !Y_AVG_SRC || !R_AVG_SRC) usedDefaultAverage = true;
  const effective_averages = { green: G_AVG, yellow: Y_AVG, red: R_AVG, unknown: 60 };
  if (!last_seen_status || !last_seen_timestamp) return { predicted_status: 'unknown', wait_time_seconds: 0, usedDefaultAverage: true };
  let currentSimTimeMs = last_seen_timestamp.getTime();
  let currentSimStatus = last_seen_status;
  if (arrivalTimeInMs < currentSimTimeMs) {
    return (currentSimTimeMs - arrivalTimeInMs) < 1000 ? { predicted_status: last_seen_status, wait_time_seconds: 0, usedDefaultAverage } : { predicted_status: 'unknown', wait_time_seconds: 0, usedDefaultAverage: true };
  }
  while (currentSimTimeMs < arrivalTimeInMs) {
    let durationForCurrentStatus = effective_averages[currentSimStatus.toLowerCase()];
    if (durationForCurrentStatus == null ) { durationForCurrentStatus = 60; usedDefaultAverage = true; }
    const avgDurationForCurrentSimStatusMs = durationForCurrentStatus * 1000;
    if (currentSimTimeMs + avgDurationForCurrentSimStatusMs > arrivalTimeInMs) {
      let timeRemainingInCurrentSimStatusMs = (currentSimTimeMs + avgDurationForCurrentSimStatusMs) - arrivalTimeInMs;
      let wait_time_seconds = 0;
      if (currentSimStatus === 'green') wait_time_seconds = 0;
      else if (currentSimStatus === 'yellow') wait_time_seconds = Math.max(0, Math.round((timeRemainingInCurrentSimStatusMs + (effective_averages.red * 1000)) / 1000));
      else if (currentSimStatus === 'red') wait_time_seconds = Math.max(0, Math.round(timeRemainingInCurrentSimStatusMs / 1000));
      return { predicted_status: currentSimStatus, wait_time_seconds, usedDefaultAverage };
    } else {
      currentSimTimeMs += avgDurationForCurrentSimStatusMs; currentSimStatus = getNextStatus(currentSimStatus);
      if (currentSimStatus === 'green' && !G_AVG_SRC) usedDefaultAverage = true;
      if (currentSimStatus === 'yellow' && !Y_AVG_SRC) usedDefaultAverage = true;
      if (currentSimStatus === 'red' && !R_AVG_SRC) usedDefaultAverage = true;
    }
  }
  let wait_time_seconds = 0;
  if (currentSimStatus === 'green') wait_time_seconds = 0;
  else if (currentSimStatus === 'red') wait_time_seconds = Math.round(effective_averages.red);
  else if (currentSimStatus === 'yellow') wait_time_seconds = Math.round(effective_averages.yellow + effective_averages.red);
  return { predicted_status: currentSimStatus, wait_time_seconds, usedDefaultAverage };
}

async function simulateRouteForDeparture(simulatableRoute, departureTimeMs, lightPredictionsMap) {
  let totalWaitTimeSeconds = 0;
  let accumulatedTravelTimeMs = 0;
  let lowConfidenceLightEncounterCount = 0;
  let totalLightsSimulated = 0;

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

        let isLowConfidenceEncounter = predictionResult.usedDefaultAverage;
        if (lightData.base_confidence === 'low') { // Assuming base_confidence is now in lightData
          isLowConfidenceEncounter = true;
        }
        if (isLowConfidenceEncounter) {
          lowConfidenceLightEncounterCount++;
        }
      } else {
        console.warn(`Sim: No prediction data for light ${segment.ends_at_traffic_light_cluster_id}. Assuming 0 wait.`);
      }
    }
  }
  return { totalWaitTimeSeconds, lowConfidenceLightEncounterCount, totalLightsSimulated };
}

async function getDepartureAdvice(simulatableRoute, lightPredictionsMap) {
  if (!simulatableRoute || !simulatableRoute.segments || simulatableRoute.segments.length === 0) {
    return { advice: "Route data insufficient for advice.", optimal_departure_offset_seconds: 0, baseline_wait_time_seconds: null, optimal_wait_time_seconds: null, wait_time_savings_seconds: 0, simulation_confidence_level: 'low', low_confidence_lights_on_optimal_route_count: 0, total_lights_simulated_on_optimal_route: 0 };
  }
  const currentTimeMs = new Date().getTime();
  const baselineSimResult = await simulateRouteForDeparture(simulatableRoute, currentTimeMs, lightPredictionsMap);
  let minWaitTimeSeconds = baselineSimResult.totalWaitTimeSeconds;
  let bestOffsetSeconds = 0;
  let lowConfidenceCountForOptimal = baselineSimResult.lowConfidenceLightEncounterCount;
  let totalLightsInOptimal = baselineSimResult.totalLightsSimulated;

  const offsetsToTest = [-60, -30, 30, 60, 90, 120, 150, 180];
  for (const offset of offsetsToTest) {
    if (offset === 0) continue;
    const currentSimResult = await simulateRouteForDeparture(simulatableRoute, currentTimeMs + (offset * 1000), lightPredictionsMap);
    if (currentSimResult.totalWaitTimeSeconds < minWaitTimeSeconds) {
        minWaitTimeSeconds = currentSimResult.totalWaitTimeSeconds; bestOffsetSeconds = offset;
        lowConfidenceCountForOptimal = currentSimResult.lowConfidenceLightEncounterCount; totalLightsInOptimal = currentSimResult.totalLightsSimulated;
    } else if (currentSimResult.totalWaitTimeSeconds === minWaitTimeSeconds) {
        if (bestOffsetSeconds > 0 && offset < bestOffsetSeconds && offset >=0) { // Prefer smaller positive or zero offset
             bestOffsetSeconds = offset; lowConfidenceCountForOptimal = currentSimResult.lowConfidenceLightEncounterCount; totalLightsInOptimal = currentSimResult.totalLightsSimulated;
        } else if (bestOffsetSeconds < 0 && offset > bestOffsetSeconds) { // Prefer offset closer to zero from negative side
             bestOffsetSeconds = offset; lowConfidenceCountForOptimal = currentSimResult.lowConfidenceLightEncounterCount; totalLightsInOptimal = currentSimResult.totalLightsSimulated;
        }
    }
  }
   if (baselineSimResult.totalWaitTimeSeconds <= minWaitTimeSeconds && bestOffsetSeconds !== 0) { // Check if baseline is still better or equal
      minWaitTimeSeconds = baselineSimResult.totalWaitTimeSeconds; bestOffsetSeconds = 0;
      lowConfidenceCountForOptimal = baselineSimResult.lowConfidenceLightEncounterCount; totalLightsInOptimal = baselineSimResult.totalLightsSimulated;
  }

  const baselineWaitTimeSeconds = baselineSimResult.totalWaitTimeSeconds;
  const waitTimeSavingsSeconds = baselineWaitTimeSeconds !== null && minWaitTimeSeconds !== null ? baselineWaitTimeSeconds - minWaitTimeSeconds : 0;
  let simulation_confidence_level = 'low';
  if (totalLightsInOptimal > 0) {
    const lowConfidenceRatio = lowConfidenceCountForOptimal / totalLightsInOptimal;
    if (lowConfidenceRatio <= 0.15) simulation_confidence_level = 'high';
    else if (lowConfidenceRatio <= 0.40) simulation_confidence_level = 'medium';
  } else if (simulatableRoute.segments.length > 0 && totalLightsInOptimal === 0) {
      simulation_confidence_level = 'n/a';
  }
  let adviceMessage = "Current departure time seems reasonable.";
  if (bestOffsetSeconds > 0 && waitTimeSavingsSeconds > 10) adviceMessage = `Depart in ${bestOffsetSeconds}s to save ~${Math.round(waitTimeSavingsSeconds)}s.`;
  else if (bestOffsetSeconds < 0 && waitTimeSavingsSeconds > 10) adviceMessage = `If left ${-bestOffsetSeconds}s ago, might save ~${Math.round(waitTimeSavingsSeconds)}s.`;
  else if (waitTimeSavingsSeconds <= 0 && bestOffsetSeconds === 0 && baselineWaitTimeSeconds !== null) adviceMessage = "Departing now optimal.";
  else if (baselineWaitTimeSeconds === null) { adviceMessage = "Baseline wait time undetermined."; simulation_confidence_level = 'low';}
  if (totalLightsInOptimal === 0 && simulatableRoute.segments.length > 0 && simulation_confidence_level !== 'n/a') {
      adviceMessage = "No predictable traffic lights on route for timing advice."; simulation_confidence_level = 'n/a';
  }
  return { advice: adviceMessage, optimal_departure_offset_seconds: bestOffsetSeconds, baseline_wait_time_seconds: baselineWaitTimeSeconds !==null ? Math.round(baselineWaitTimeSeconds) : null, optimal_wait_time_seconds: minWaitTimeSeconds !== null ? Math.round(minWaitTimeSeconds) : null, wait_time_savings_seconds: Math.round(waitTimeSavingsSeconds), simulation_confidence_level, low_confidence_lights_on_optimal_route_count: lowConfidenceCountForOptimal, total_lights_simulated_on_optimal_route: totalLightsInOptimal };
}

function decodeGooglePolyline(encoded) { /* ... existing ... */ }
async function fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId) { /* ... existing ... */ }
app.post('/route_departure_advice', async (req, res) => { /* ... existing ... */ });
app.get('/light_timings/:latitude/:longitude', async (req, res) => { /* ... existing ... */ });
