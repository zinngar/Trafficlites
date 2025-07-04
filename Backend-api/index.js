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
app.post('/report', async (req, res) => { /* ... (condensed) ... */ });

const CLUSTERING_RADIUS_METERS = 50;

function getDistance(lat1, lon1, lat2, lon2) { /* ... (condensed) ... */ }
async function processReportForTiming(dbPool, report) { /* ... (condensed) ... */ }
app.get('/reports', async (req, res) => { /* ... (condensed) ... */ });
app.listen(PORT, async () => { /* ... (condensed, includes localInitDb) ... */ });

function getNextStatus(currentStatus) { /* ... (condensed) ... */ }

// --- Polyline & Simulation Helper Functions ---
function getDistanceOfPolyline(polylinePoints, startIndex = 0, endIndex = -1) { /* ... (condensed) ... */ }
function getLightProjectionOnStep(lightLocation, stepPolylinePoints) { /* ... (condensed - renamed from getLightProjectionOnPolyline) ... */ }
function predictLightStateAtFutureTime(lightData, arrivalTimeInMs) { /* ... (condensed) ... */ }
async function simulateRouteForDeparture(simulatableRoute, departureTimeMs, lightPredictionsMap) { /* ... (condensed) ... */ }
async function getDepartureAdvice(simulatableRoute, lightPredictionsMap) { /* ... (condensed) ... */ }
function decodeGooglePolyline(encoded) { /* ... (condensed) ... */ }
async function fetchLightTimingAndPredictionDataForCluster(dbPool, clusterId) { /* ... (condensed) ... */ }


app.post('/route_departure_advice', async (req, res) => {
  const dbPool = req.app.locals.dbPool;
  const { origin, destination } = req.body;
  if (!origin || typeof origin.lat !== 'number' || typeof origin.lon !== 'number' || !destination || typeof destination.lat !== 'number' || typeof destination.lon !== 'number') {
    return res.status(400).json({ error: 'Invalid origin/destination. Expected {lat:num, lon:num}.' });
  }
  const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY_BACKEND;
  if (!GOOGLE_API_KEY) return res.status(500).json({ error: 'Routing API key not configured.' });

  try {
    const googleDirectionsURL = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lon}&destination=${destination.lat},${destination.lon}&key=${GOOGLE_API_KEY}`;
    let googleRouteData;
    try {
      const dRes = await axios.get(googleDirectionsURL);
      if (dRes.data.routes && dRes.data.routes.length > 0) googleRouteData = dRes.data.routes[0];
      else return res.status(404).json({ error: 'Route not found by Google.', details: dRes.data.status });
    } catch (e) { return res.status(502).json({ error: 'Failed to fetch route from external service.' }); }

    const lightPredictionsMap = new Map();
    const uniqueClusterIdsOnEntireRoute = new Set();

    // Initial pass to find all potentially relevant lights (Phase 4 logic)
    for (const step of googleRouteData.legs[0].steps) { /* ... (condensed - populates uniqueClusterIdsOnEntireRoute) ... */ }
    for (const clusterId of uniqueClusterIdsOnEntireRoute) { /* ... (condensed - populates lightPredictionsMap) ... */ }

    // --- START: Phase 11, Step 2 --- Identify & Globally Order Lights Along Full Route Path ---
    let fullRoutePolylinePoints = [];
    if (googleRouteData.legs && googleRouteData.legs.length > 0) {
        googleRouteData.legs[0].steps.forEach(step => {
            const stepPoints = decodeGooglePolyline(step.polyline.points);
            if (stepPoints.length > 0) { fullRoutePolylinePoints.push(...stepPoints); }
            else if (step.start_location && step.end_location) {
                fullRoutePolylinePoints.push({latitude: step.start_location.lat, longitude: step.start_location.lng});
                if(step.start_location.lat !== step.end_location.lat || step.start_location.lng !== step.end_location.lng) {
                    fullRoutePolylinePoints.push({latitude: step.end_location.lat, longitude: step.end_location.lng});
                }
            }
        });
        if (fullRoutePolylinePoints.length > 0) {
            fullRoutePolylinePoints = Array.from(new Set(fullRoutePolylinePoints.map(p => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`)))
                                        .map(s => { const [lat,lon] = s.split(','); return {latitude: parseFloat(lat), longitude: parseFloat(lon)}; });
        }
    }
    const allLightsOnRouteOrdered = [];
    for (const [clusterId, lightData] of lightPredictionsMap.entries()) {
        if (!lightData.cluster_center) continue;
        const projection = getLightProjectionOnStep(lightData.cluster_center, fullRoutePolylinePoints); // Use helper
        if (projection && projection.minDistanceToVertex < (CLUSTERING_RADIUS_METERS * 2)) {
            allLightsOnRouteOrdered.push({
                cluster_id: clusterId, location: lightData.cluster_center,
                pathDistanceAlongFullRoute: projection.distanceFromStepStartAlongPolyline,
                closestVertexIndexOnFullPolyline: projection.indexOnPolyline,
                base_confidence: lightData.base_confidence
            });
        }
    }
    allLightsOnRouteOrdered.sort((a, b) => a.pathDistanceAlongFullRoute - b.pathDistanceAlongFullRoute);
    // --- END: Phase 11, Step 2 ---

    // --- START: Phase 11, Step 3 --- Map Globally Ordered Lights to Specific Google Steps ---
    const stepSpecificLightsData = new Map();
    let cumulativePolylineDistanceAtStepStart = 0;
    let currentGlobalLightIndex = 0;

    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        let currentStepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
        if (currentStepPolylineDecoded.length === 0 && !(step.start_location.lat === step.end_location.lat && step.start_location.lng === step.end_location.lng)) {
            currentStepPolylineDecoded = [{latitude: step.start_location.lat, longitude: step.start_location.lng}, {latitude: step.end_location.lat, longitude: step.end_location.lng}];
        } else if (currentStepPolylineDecoded.length === 0) {
             stepSpecificLightsData.set(stepIndex, []); continue;
        }
        const currentStepPolylinePathLength = getDistanceOfPolyline(currentStepPolylineDecoded);
        const stepOverallEndDistance = cumulativePolylineDistanceAtStepStart + currentStepPolylinePathLength;
        const lightsFoundInThisGoogleStep = [];

        // Iterate through the globally ordered lights to see which ones fall into this step's span
        while (currentGlobalLightIndex < allLightsOnRouteOrdered.length &&
               allLightsOnRouteOrdered[currentGlobalLightIndex].pathDistanceAlongFullRoute <= stepOverallEndDistance) {

            const orderedLight = allLightsOnRouteOrdered[currentGlobalLightIndex];
            if (orderedLight.pathDistanceAlongFullRoute >= cumulativePolylineDistanceAtStepStart) {
                // This light is within the current step's global path span.
                // Re-project onto this specific step's polyline for accurate relative distance and index.
                const stepProjection = getLightProjectionOnStep(orderedLight.location, currentStepPolylineDecoded);
                if (stepProjection && stepProjection.minDistanceToVertex < (CLUSTERING_RADIUS_METERS * 1.2)) {
                    lightsFoundInThisGoogleStep.push({
                        cluster_id: orderedLight.cluster_id,
                        location: orderedLight.location,
                        distanceFromStepStartAlongPolyline: stepProjection.distanceFromStepStartAlongPolyline,
                        projectedPointIndexOnStepPolyline: stepProjection.indexOnPolyline,
                        base_confidence: orderedLight.base_confidence
                    });
                }
            }
            currentGlobalLightIndex++;
        }
        // Since a light might be associated with the end of one step and start of next due to projection,
        // we might need to reset currentGlobalLightIndex if it overshot but next step might contain same lights.
        // For now, simple advance. If a light is on boundary, it might be missed by one step if stepOverallEndDistance is exact.
        // A small epsilon could be used, or ensure lights projected to start of next step are caught.
        // The re-projection handles this better: `currentGlobalLightIndex` advances, and next step re-projects remaining global lights.

        // Reset for next step to re-evaluate lights from the start of allLightsOnRouteOrdered that are relevant to it.
        // This is less efficient but more robust if lights are on boundaries.
        // A better way is to not reset currentGlobalLightIndex but ensure the condition catches boundary lights for the *next* step.
        // The current while loop structure should handle this as currentGlobalLightIndex only advances.

        lightsFoundInThisGoogleStep.sort((a, b) => a.distanceFromStepStartAlongPolyline - b.distanceFromStepStartAlongPolyline);
        stepSpecificLightsData.set(stepIndex, lightsFoundInThisGoogleStep);
        cumulativePolylineDistanceAtStepStart = stepOverallEndDistance;
    }
    // --- END: Phase 11, Step 3 ---

    // Segment Reconstruction (Phase 9, Step 3 logic) - uses stepSpecificLightsData
    const simulatableRoute = { /* ... (initialization) ... */ };
    simulatableRoute.segments = [];
    let currentPathOverallStartLocationForSeg = { ...simulatableRoute.origin };
    for (let stepIndex = 0; stepIndex < googleRouteData.legs[0].steps.length; stepIndex++) {
        const step = googleRouteData.legs[0].steps[stepIndex];
        let stepPolylineDecoded = decodeGooglePolyline(step.polyline.points);
        if (stepPolylineDecoded.length === 0 && !(step.start_location.lat === step.end_location.lat && step.start_location.lng === step.end_location.lng)) {
             stepPolylineDecoded = [{latitude: step.start_location.lat, longitude: step.start_location.lng}, {latitude: step.end_location.lat, longitude: step.end_location.lng}];
        } else if (stepPolylineDecoded.length === 0) { continue; }

        const lightsOnThisStep = stepSpecificLightsData.get(stepIndex) || [];
        let lastProcessedLocationForCurrentStep = currentPathOverallStartLocationForSeg;
        let lastProcessedPolylineIndexOnStep = 0;
        let cumulativeDurationApportionedThisStep = 0;
        const totalStepPolylineActualDistance = getDistanceOfPolyline(stepPolylineDecoded, 0, -1);

        for (const lightInfo of lightsOnThisStep) {
            const subSegmentPolylineDistance = getDistanceOfPolyline(stepPolylineDecoded, lastProcessedPolylineIndexOnStep, lightInfo.projectedPointIndexOnStepPolyline);
            let fractionOfStep = 0;
            if (totalStepPolylineActualDistance > 0.1) { fractionOfStep = subSegmentPolylineDistance / totalStepPolylineActualDistance; }
            else if (lightsOnThisStep.length > 0) { fractionOfStep = 1 / lightsOnThisStep.length; }
            const apportionedDuration = Math.round(step.duration.value * fractionOfStep);
            const apportionedDistance = Math.round(subSegmentPolylineDistance);
            if (apportionedDistance > 0 || apportionedDuration > 0 || (lightsOnThisStep.length === 1 && lightInfo.cluster_id === lightsOnThisStep[0].cluster_id)) {
                 simulatableRoute.segments.push({ start_location: lastProcessedLocationForCurrentStep, end_location: lightInfo.location, duration_seconds: apportionedDuration, distance_meters: apportionedDistance, ends_at_traffic_light_cluster_id: lightInfo.cluster_id });
                 cumulativeDurationApportionedThisStep += apportionedDuration;
            }
            lastProcessedLocationForCurrentStep = lightInfo.location;
            lastProcessedPolylineIndexOnStep = lightInfo.projectedPointIndexOnStepPolyline;
        }
        const remainingPolylinePathDistance = getDistanceOfPolyline(stepPolylineDecoded, lastProcessedPolylineIndexOnStep, -1);
        const finalSegmentDuration = Math.max(0, step.duration.value - cumulativeDurationApportionedThisStep);
        const finalSegmentDistance = Math.round(remainingPolylinePathDistance);
        let clusterAtGoogleStepEnd = null;
        for (const [cid, ld] of lightPredictionsMap.entries()) { if (ld.cluster_center && getDistance(step.end_location.lat, step.end_location.lng, ld.cluster_center.latitude, ld.cluster_center.longitude) < CLUSTERING_RADIUS_METERS * 0.5) { clusterAtGoogleStepEnd = cid; break; } }
        if (finalSegmentDistance > 0 || finalSegmentDuration > 0 || lightsOnThisStep.length === 0) {
             simulatableRoute.segments.push({ start_location: lastProcessedLocationForCurrentStep, end_location: { latitude: step.end_location.lat, longitude: step.end_location.lng }, duration_seconds: finalSegmentDuration, distance_meters: finalSegmentDistance, ends_at_traffic_light_cluster_id: clusterAtGoogleStepEnd });
        }
        currentPathOverallStartLocationForSeg = { latitude: step.end_location.lat, longitude: step.end_location.lng };
    }
    // End Segment Reconstruction

    if (simulatableRoute.segments.length === 0 && googleRouteData.legs[0].steps.length > 0) return res.status(500).json({ error: "Failed to process segments."});
    if (uniqueClusterIdsOnEntireRoute.size === 0) return res.json({ advice: "No known lights on route.", route: googleRouteData });

    const adviceResult = await getDepartureAdvice(simulatableRoute, lightPredictionsMap);
    res.json({ ...adviceResult, route: googleRouteData });

  } catch (err) {
    console.error('Error in /route_departure_advice:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.get('/light_timings/:latitude/:longitude', async (req, res) => { /* ... existing ... */ });

// Condensed helper function definitions for brevity in this view
// predictLightStateAtFutureTime, simulateRouteForDeparture, getDepartureAdvice,
// decodeGooglePolyline, fetchLightTimingAndPredictionDataForCluster are assumed to be complete.
// getDistanceOfPolyline, getLightProjectionOnStep, getNextStatus are also present.
