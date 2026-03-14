const express = require('express');
const { Kafka } = require('kafkajs');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MANAGEMENT_API_URL = process.env.MANAGEMENT_API_URL || 'http://customer-management:4000';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'purchases';

// Remarks:
// Web service is intentionally simple and stateless; all business state lives in Mongo.
// It only publishes buy events to Kafka and proxies read requests to management service.
const kafka = new Kafka({
  clientId: 'customer-facing-web',
  brokers: KAFKA_BROKERS,
});
const producer = kafka.producer();

async function publishPurchase(purchase) {
  await producer.send({
    topic: KAFKA_TOPIC,
    messages: [{ key: String(purchase.userid), value: JSON.stringify(purchase) }],
  });
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Customer Purchases</title>
    <style>
      body { font-family: Inter, Segoe UI, Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; background: linear-gradient(140deg, #f7fbff, #eef5ff); }
      h1 { color: #123a73; }
      label { display: block; margin: 8px 0 4px; }
      input { width: 100%; padding: 8px; margin-bottom: 8px; }
      button { margin-right: 12px; padding: 10px 16px; cursor: pointer; }
      .row { margin: 16px 0; }
      #output { white-space: pre-wrap; background: #fff; border: 1px solid #cfe1ff; padding: 12px; min-height: 120px; }
    </style>
  </head>
  <body>
    <h1>Customer Purchase UI</h1>
    <div class="row">
      <label>Username</label>
      <input id="username" placeholder="alice" />
      <label>User ID</label>
      <input id="userid" placeholder="u-101" />
      <label>Price</label>
      <input id="price" type="number" step="0.01" placeholder="19.90" />
    </div>
    <div class="row">
      <button id="buyBtn">Buy</button>
      <button id="getBtn">getAllUserBuys</button>
    </div>
    <h3>Response</h3>
    <div id="output"></div>
    <script>
      const output = document.getElementById('output');
      document.getElementById('buyBtn').onclick = async () => {
        const payload = {
          username: document.getElementById('username').value.trim(),
          userid: document.getElementById('userid').value.trim(),
          price: Number(document.getElementById('price').value),
          timestamp: new Date().toISOString()
        };
        const response = await fetch('/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        output.textContent = await response.text();
      };
      document.getElementById('getBtn').onclick = async () => {
        const username = document.getElementById('username').value.trim();
        const response = await fetch('/getAllUserBuys' + (username ? '?username=' + encodeURIComponent(username) : ''));
        output.textContent = await response.text();
      };
    </script>
  </body>
</html>`);
});

app.post('/buy', async (req, res) => {
  const { username, userid, price } = req.body || {};
  if (!username || !userid || !Number.isFinite(Number(price))) {
    return res.status(400).json({ error: 'username, userid, and price are required' });
  }

  const purchase = {
    id: randomUUID(),
    username,
    userid,
    price: Number(price),
    timestamp: req.body.timestamp || new Date().toISOString(),
  };

  try {
    await publishPurchase(purchase);
    res.status(202).json({
      status: 'accepted',
      event: purchase,
      message: 'Purchase event published to Kafka.',
    });
  } catch (err) {
    console.error('Kafka publish error:', err);
    res.status(500).json({ error: 'Could not publish purchase event' });
  }
});

app.get('/getAllUserBuys', async (req, res) => {
  const username = req.query.username;
  const query = new URLSearchParams();
  if (username) query.set('username', username);

  const url = `${MANAGEMENT_API_URL}/purchases${query.toString() ? `?${query.toString()}` : ''}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: err || 'management service error' });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('getAllUserBuys proxy error:', err);
    res.status(500).json({ error: 'Could not fetch purchases from management service' });
  }
});

async function bootstrap() {
  await producer.connect();
  app.listen(PORT, () => {
    console.log(`Customer-facing service listening on ${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Could not bootstrap web service:', error);
  process.exit(1);
});
