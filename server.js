require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// ✅ MySQL connection (use connection pool)
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

// ✅ TTN Webhook - Sensor Data Receive
app.post('/ttn', (req, res) => {
  try {
    const devId = req.body.end_device_ids?.device_id;
    const payload = req.body.uplink_message?.decoded_payload?.decoded || req.body.uplink_message?.decoded_payload || {};
    const timestamp = new Date().toISOString();

    const entry = {
      time: timestamp,
      gas1: payload.gas1Prob ?? payload.gas1,
      gas2: payload.gas2Prob ?? payload.gas2,
      temperature: payload.temperature,
      humidity: payload.humidity,
      pressure: payload.pressure,
      supercap_voltage: payload.superCapVoltage,
      button_level: payload.buttonLevel
    };

    if (!devId || Object.values(entry).every(val => val === undefined)) {
      console.warn('⚠️ Tukšs vai nederīgs dati, netika saglabāti');
      return res.status(400).send('Invalid data');
    }

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
        res.status(500).send('DB insert error');
      } else {
        console.log(`✅ Dati saglabāti sensoram: ${devId}`);
        res.send('OK');
      }
    });

  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).send('Internal error');
  }
});

// ✅ API - Latest measurements for all sensors
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
      res.status(500).send('Database error');
    } else {
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
    }
  });
});

// ✅ API - Historical data for specific sensor
app.get('/api/sensor/:id', (req, res) => {
  const sensorId = req.params.id;
  const query = 'SELECT * FROM sensor_data WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT 100';

  db.query(query, [sensorId], (err, results) => {
    if (err) {
      console.error('❌ Error fetching history:', err);
      res.status(500).send('Database error');
    } else {
      res.json(results);
    }
  });
});

// ✅ API - Sensor location data for map
app.get('/api/map-sensors', (req, res) => {
  db.query('SELECT * FROM sensors', (err, results) => {
    if (err) {
      console.error('❌ Error fetching map sensor data:', err);
      res.status(500).send('Database error');
    } else {
      res.json(results);
    }
  });
});

// ✅ API - Update/add sensor location (for admin panel)
app.post('/api/sensor-location/:id', (req, res) => {
  const id = req.params.id;
  const { label, latitude, longitude } = req.body;

  const query = `
    INSERT INTO sensors (sensor_id, label, latitude, longitude)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      label = VALUES(label),
      latitude = VALUES(latitude),
      longitude = VALUES(longitude)
  `;

  db.query(query, [id, label, latitude, longitude], (err) => {
    if (err) {
      console.error('❌ Sensor location update error:', err);
      res.status(500).send('Database error');
    } else {
      res.sendStatus(200);
    }
  });
});

// ✅ Routes for frontend pages
app.get('/sensor/:id', (req, res) => {
  res.sendFile(__dirname + '/public/sensor.html');
});

app.get('/map', (req, res) => {
  res.sendFile(__dirname + '/public/map.html');
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/public/admin.html');
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
