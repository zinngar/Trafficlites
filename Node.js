// Trafficlites Backend - Node.js + Express + PostgreSQL

const express = require('express'); const cors = require('cors'); const { Pool } = require('pg'); require('dotenv').config();

const app = express(); const PORT = process.env.PORT || 4000;

app.use(cors()); app.use(express.json());

// PostgreSQL connection pool const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/trafficlites' });

// Create table if it doesn't exist const initDb = async () => { await pool.query(CREATE TABLE IF NOT EXISTS reports ( id SERIAL PRIMARY KEY, latitude FLOAT NOT NULL, longitude FLOAT NOT NULL, status TEXT NOT NULL, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP )); console.log('Database initialized'); };

// Test route app.get('/', (req, res) => { res.send('Trafficlites API with PostgreSQL is running'); });

// POST: User submits traffic light report app.post('/report', async (req, res) => { const { latitude, longitude, status } = req.body; if (!latitude || !longitude || !status) { return res.status(400).json({ error: 'Missing data' }); }

try { const result = await pool.query( 'INSERT INTO reports (latitude, longitude, status) VALUES ($1, $2, $3) RETURNING *', [latitude, longitude, status] ); res.status(201).json({ message: 'Report saved', report: result.rows[0] }); } catch (err) { console.error(err); res.status(500).json({ error: 'Database error' }); } });

// GET: Return all reports app.get('/reports', async (req, res) => { try { const result = await pool.query('SELECT * FROM reports ORDER BY timestamp DESC'); res.json(result.rows); } catch (err) { console.error(err); res.status(500).json({ error: 'Database error' }); } });

app.listen(PORT, async () => { await initDb(); console.log(Trafficlites backend listening on port ${PORT}); });
