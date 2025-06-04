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

// ✅ Webhook no TTN ar validāciju
app.post('/ttn', (req, res) => {
  try {
    const devId = req.body.end_device_ids?.device_id;
    const rawPayload = req.body.uplink_message?.decoded_payload;

    // ❗ Pārbaude — ja nav decoded_payload, tad ignorē
    if (!rawPayload || typeof rawPayload !== 'object') {
      console.log('⚠️ Ziņa bez decoded_payload. Izlaižam.');
      return res.status(204).send(); // Bez satura
    }

    // Atbalsts gan ar, gan bez .decoded ligzdas
    const payload = rawPayload.decoded ?? rawPayload;

    // ❗ Ja nav būtisko lauku, arī izlaiž
    if (
      payload.gas1Prob == null &&
      payload.gas1 == null &&
      payload.temperature == null &&
      payload.superCapVoltage == null
    ) {
      console.log('⚠️ decoded_payload nesatur datus. Izlaižam.');
      return res.status(204).send();
    }

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
        console.log(`✅ Dati saglabāti no sensor: ${devId}`);
      }
    });

    res.send('OK');
  } catch (err) {
    console.error('❌ Error processing webhook:', err);
    res.status(500).send('Internal error');
  }
});

// ✅ Galvenajai lapai: pēdējie mērījumi no DB
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

// ✅ Vēsturiskie dati konkrētam sensoram
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

// ✅ Nosūta sensor.html kad atver lapu
app.get('/sensor/:id', (req, res) => {
  res.sendFile(__dirname + '/public/sensor.html');
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
