require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

let db;

function handleDisconnect() {
  db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
  });

  db.connect(err => {
    if (err) {
      console.error('❌ Error connecting to MySQL:', err);
      setTimeout(handleDisconnect, 2000);
    } else {
      console.log('✅ Connected to MySQL');
    }
  });

  db.on('error', err => {
    console.error('❌ MySQL error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.fatal) {
      console.log('🔁 Reconnecting to MySQL...');
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

handleDisconnect();

// Webhook no TTN
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

// Galvenās lapas pēdējie dati
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

// Vēsturiskie dati konkrētam sensoram
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

// Sensoru koordinātes priekš kartes
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

// Saglabā koordinātes
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

// Sensoru skatījums
app.get('/sensor/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/sensor.html'));
});

// Admin lapa
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Sākumlapas fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
