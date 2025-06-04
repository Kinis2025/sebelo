require('dotenv').config();
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
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

db.connect((err) => {
  if (err) {
    console.error('❌ MySQL connection failed:', err);
  } else {
    console.log('✅ Connected to MySQL database');
  }
});

// ✅ Webhook no TTN
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

    // ✅ Saglabā datubāzē
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

// ✅ Sākuma API ar pēdējiem datiem (index.html)
app.get('/api/sensors', (req, res) => {
  res.json(sensorData);
});

// ✅ Katra sensora vēsturiskie dati JSON (sensor.html izmantos)
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

// ✅ Nosūta vēstures HTML failu, kad atver lapu par sensoru
app.get('/sensor/:id', (req, res) => {
  res.sendFile(__dirname + '/public/sensor.html');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
