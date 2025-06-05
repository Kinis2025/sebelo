require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Static un parsēšana
app.use(bodyParser.json());
app.use(express.static('public'));

// ✅ Izmanto connection pool
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ✅ TTN Webhook
app.post('/ttn', (req, res) => {
  try {
    const devId = req.body.end_device_ids?.device_id;
    const payload = req.body.uplink_message.decoded_payload?.decoded || req.body.uplink_message.decoded_payload || {};
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

    db.query(query, [
      devId,
      timestamp,
      entry.gas1,
      entry.gas2,
      entry.temperature,
      entry.humidity,
      entry.pressure,
      entry.supercap_voltage,
      entry.button_level
    ], (err) => {
      if (err) {
        console.error('❌ MySQL insert error:', err);
      } else {
        console.log(`✅ Dati saglabāti sensoram: ${devId}`);
      }
    });

    res.send('OK');
  } catch (err) {
    console.error('❌ Webhook processing error:', err);
    res.status(500).send('Internal error');
  }
});

// ✅ Jaunākie dati
app.get('/api/sensors', (req, res) => {
  const query = `
    SELECT * FROM sensor_data AS sd
    INNER JOIN (
      SELECT sensor_id, MAX(timestamp) AS latest
      FROM sensor_data
      GROUP BY sensor_id
    ) AS latest_data
    ON sd.sensor_id = latest_data.sensor_id AND sd.timestamp = latest_data.latest
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error('❌ Error fetching latest measurements:', err);
      return res.status(500).send('Database error');
    }

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
  });
});

// ✅ Vēsturiskie dati
app.get('/api/sensor/:id', (req, res) => {
  const sensorId = req.params.id;
  const query = 'SELECT * FROM sensor_data WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 100';

  db.query(query, [sensorId], (err, results) => {
    if (err) {
      console.error('❌ Error fetching history:', err);
      return res.status(500).send('Database error');
    }
    res.json(results);
  });
});

// ✅ Sensoru koordinātas kartes vajadzībām
app.get('/api/map-sensors', (req, res) => {
  const query = 'SELECT * FROM sensors';

  db.query(query, (err, results) => {
    if (err) {
      console.error('❌ Error fetching sensor locations:', err);
      return res.status(500).send('Database error');
    }
    res.json(results);
  });
});

// ✅ Atjauno vai ievieto koordinātas
app.post('/api/update-location', (req, res) => {
  const { sensor_id, label, latitude, longitude } = req.body;
  const query = `
    INSERT INTO sensors (sensor_id, label, latitude, longitude)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE label = VALUES(label), latitude = VALUES(latitude), longitude = VALUES(longitude)
  `;

  db.query(query, [sensor_id, label, latitude, longitude], (err) => {
    if (err) {
      console.error('❌ Error updating coordinates:', err);
      return res.status(500).send('Database error');
    }
    res.send('OK');
  });
});

// ✅ Vēja dati no OWM
app.get('/api/wind/:sensorId', (req, res) => {
  const sensorId = req.params.sensorId;
  const apiKey = process.env.OWM_API_KEY;

  const query = 'SELECT latitude, longitude FROM sensors WHERE sensor_id = ? LIMIT 1';

  db.query(query, [sensorId], async (err, results) => {
    if (err || results.length === 0) {
      console.error('❌ Sensor location error:', err || 'Not found');
      return res.status(500).send('Sensor location not found');
    }

    const { latitude, longitude } = results[0];
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${apiKey}&units=metric`;

    try {
      const response = await axios.get(url);
      const wind = response.data.wind;
      res.json({
        speed: wind.speed,
        deg: wind.deg,
        gust: wind.gust || null
      });
    } catch (apiError) {
      console.error('❌ OpenWeatherMap API error:', apiError.message);
      res.status(500).send('Failed to fetch wind data');
    }
  });
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
