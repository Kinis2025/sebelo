require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// ✅ Connection pool ar keep-alive un promisified queries
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
}).promise();

// ✅ Ping datubāzei reizi 1 minūtē, lai neatslēdzas
setInterval(() => {
  db.query('SELECT 1').catch(err => {
    console.error('❌ MySQL ping error:', err);
  });
}, 60000);

// ✅ TTN Webhook
app.post('/ttn', async (req, res) => {
  try {
    const devId = req.body?.end_device_ids?.device_id;
    if (!devId) {
      console.warn('⚠️ Webhook without device_id!');
      return res.status(400).send('Missing device_id');
    }

    const payload = req.body?.uplink_message?.decoded_payload?.decoded ||
                    req.body?.uplink_message?.decoded_payload || {};
    const timestamp = new Date().toISOString();

    const entry = {
      gas1: payload.gas1Prob ?? payload.gas1,
      gas2: payload.gas2Prob ?? payload.gas2,
      temperature: payload.temperature,
      humidity: payload.humidity,
      pressure: payload.pressure,
      supercap_voltage: payload.superCapVoltage,
      button_level: payload.buttonLevel
    };

    const query = `
      INSERT INTO sensor_data
      (sensor_id, timestamp, gas1, gas2, temperature, humidity, pressure, supercap_voltage, button_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(query, [
      devId,
      timestamp,
      entry.gas1,
      entry.gas2,
      entry.temperature,
      entry.humidity,
      entry.pressure,
      entry.supercap_voltage,
      entry.button_level
    ]);

    console.log(`✅ Dati saglabāti sensoram: ${devId}`);
    res.send('OK');
  } catch (err) {
    console.error('❌ Webhook processing error:', err);
    res.status(500).send('Internal error');
  }
});

// ✅ Jaunākie dati
app.get('/api/sensors', async (req, res) => {
  const query = `
    SELECT * FROM sensor_data AS sd
    INNER JOIN (
      SELECT sensor_id, MAX(timestamp) AS latest
      FROM sensor_data
      GROUP BY sensor_id
    ) AS latest_data
    ON sd.sensor_id = latest_data.sensor_id AND sd.timestamp = latest_data.latest
  `;

  try {
    const [results] = await db.query(query);
    const response = {};
    results.forEach(row => {
      response[row.sensor_id] = {
        time: row.timestamp,
        gas1: row.gas1,
        gas2: row.gas2,
        temperature: row.temperature,
        humidity: row.humidity,
        pressure: row.pressure,
        supercap_voltage: row.supercap_voltage,
        button_level: row.button_level
      };
    });
    res.json(response);
  } catch (err) {
    console.error('❌ Error fetching latest measurements:', err);
    res.status(500).send('Database error');
  }
});

// ✅ Vēsturiskie dati
app.get('/api/sensor/:id', async (req, res) => {
  try {
    const [results] = await db.query(
      'SELECT * FROM sensor_data WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 100',
      [req.params.id]
    );
    res.json(results);
  } catch (err) {
    console.error('❌ Error fetching history:', err);
    res.status(500).send('Database error');
  }
});

// ✅ Sensoru koordinātas
app.get('/api/map-sensors', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM sensors');
    res.json(results);
  } catch (err) {
    console.error('❌ Error fetching sensor locations:', err);
    res.status(500).send('Database error');
  }
});

// ✅ Atjauno/ievieto koordinātas
app.post('/api/update-location', async (req, res) => {
  const { sensor_id, label, latitude, longitude } = req.body;

  try {
    await db.query(`
      INSERT INTO sensors (sensor_id, label, latitude, longitude)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        label = VALUES(label),
        latitude = VALUES(latitude),
        longitude = VALUES(longitude)
    `, [sensor_id, label, latitude, longitude]);

    res.send('OK');
  } catch (err) {
    console.error('❌ Error updating coordinates:', err);
    res.status(500).send('Database error');
  }
});

// ✅ Vēja dati no OWM
app.get('/api/wind/:sensorId', async (req, res) => {
  const sensorId = req.params.sensorId;
  const apiKey = process.env.OWM_API_KEY;

  try {
    const [results] = await db.query(
      'SELECT latitude, longitude FROM sensors WHERE sensor_id = ? LIMIT 1',
      [sensorId]
    );

    if (!results.length) {
      return res.status(404).send('Sensor location not found');
    }

    const { latitude, longitude } = results[0];
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=metric`;
    const response = await axios.get(url);
    const wind = response.data.wind;

    res.json({
      speed: wind.speed,
      deg: wind.deg,
      gust: wind.gust || null
    });
  } catch (err) {
    console.error('❌ OpenWeatherMap API error:', err.message);
    res.status(500).send('Failed to fetch wind data');
  }
});

// ✅ Statiskās lapas
app.get('/sensor/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/sensor.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ✅ Startē serveri
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
