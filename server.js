const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

let sensors = {};

app.use(bodyParser.json());

app.post('/ttn', (req, res) => {
    const { end_device_ids, uplink_message } = req.body;
    const id = end_device_ids.device_id;
    const data = uplink_message.decoded_payload;

    sensors[id] = {
        time: new Date().toISOString(),
        ...data
    };

    console.log(`Dati saņemti no ${id}`, data);
    res.status(200).send('OK');
});

app.get('/api/sensors', (req, res) => {
    res.json(sensors);
});

app.use(express.static('public'));

app.listen(PORT, () => console.log(`Serveris darbojas uz http://localhost:${PORT}`));
