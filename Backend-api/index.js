// Trafficlites Backend - Node.js + Express + Supabase
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { getDistance, predictLightStateAtFutureTime } = require('./services.js');

// --- Configuration & Constants ---
const PORT = process.env.PORT || 4000;

// --- Supabase Client Setup ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Supabase URL and Anon Key are required. Make sure to set them in your .env file.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Custom Validation Middleware ---
const validate = (validations) => {
    return async (req, res, next) => {
        const errors = [];
        for (const validation of validations) {
            const { field, location, message, validator } = validation;
            let value;
            if (location === 'body') value = req.body[field];
            if (location === 'params') value = req.params[field];

            if (value === undefined || value === null || !validator(value)) {
                errors.push({ field, message });
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({ errors });
        }
        next();
    };
};

const reportValidation = validate([
    { field: 'latitude', location: 'body', message: 'Latitude must be a valid number.', validator: (v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 90 },
    { field: 'longitude', location: 'body', message: 'Longitude must be a valid number.', validator: (v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= 180 },
    { field: 'status', location: 'body', message: 'Status must be one of green, yellow, or red.', validator: (v) => ['green', 'yellow', 'red'].includes(v) },
]);

const lightTimingsValidation = validate([
    { field: 'latitude', location: 'params', message: 'Latitude must be a valid number.', validator: (v) => !isNaN(parseFloat(v)) && isFinite(v) && Math.abs(v) <= 90 },
    { field: 'longitude', location: 'params', message: 'Longitude must be a valid number.', validator: (v) => !isNaN(parseFloat(v)) && isFinite(v) && Math.abs(v) <= 180 },
]);

// --- API Endpoints ---
app.post('/report', reportValidation, async (req, res) => {
    const { latitude, longitude, status } = req.body;
    try {
        const { data, error } = await supabase
            .from('reports')
            .insert([{ latitude, longitude, status }]);

        if (error) {
            console.error('Error inserting report:', error);
            return res.status(500).json({ error: 'Failed to store report.' });
        }

        res.status(201).json({ message: 'Report created successfully.', data });
    } catch (error) {
        console.error('Error processing report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/light_timings/:latitude/:longitude', lightTimingsValidation, async (req, res) => {
    const latitude = parseFloat(req.params.latitude);
    const longitude = parseFloat(req.params.longitude);

    try {
        const { data: lightData, error } = await supabase.rpc('get_nearby_light_data', {
            lat: latitude,
            lon: longitude
        });

        if (error) {
            console.error('Error fetching light data:', error);
            return res.status(500).json({ error: 'Failed to fetch light data.' });
        }

        if (!lightData) {
            return res.status(404).json({ message: 'No traffic light data found for the given location.' });
        }

        const arrivalTime = Date.now() + 30000; // 30 seconds from now
        const prediction = predictLightStateAtFutureTime(lightData, arrivalTime);

        res.status(200).json({
            requested_coords: { latitude, longitude },
            prediction_for_arrival_in_30s: prediction,
        });
    } catch (error) {
        console.error('Error fetching light timings:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// --- Server Initialization ---
const startServer = async () => {
    app.listen(PORT, () => {
        console.log(`Trafficlites backend listening on port ${PORT}`);
    });
};

startServer();
