const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

const sensorData = {};

// ✅ MySQL savienojums
const db = mysql.createConnection({
  host: '18.196.124.62',
  user: 'root',
  password: 'gALX2AKwpLBFEBk1#',
  database: 'sebelo',
  port: 3306
});

db.connect((err) => {
  if (err) {
    console.error('❌ MySQL connection failed:', err);
  } else {
    console.log('✅ Connected to MySQL database');
  }
});

app.post('/ttn', (req, res) => {
  try {
    const devId = req.body.end_device_ids.device_id;
    const payload = req.body.uplink_message.decoded_payload?.decoded || req.body.uplink_message.decoded_payload || {};
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

    sensorData[devId] = entry;

    // ✅ Pierakstām datubāzē
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
        console.log(`✅ Data saved for sensor: ${devId}`);
      }
    });

    res.send('OK');
  } catch (err) {
    console.error('❌ Error processing webhook:', err);
    res.status(500).send('Internal error');
  }
});

app.get('/api/sensors', (req, res) => {
  res.json(sensorData);
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
