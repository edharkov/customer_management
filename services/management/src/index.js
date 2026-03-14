const express = require('express');
const { MongoClient } = require('mongodb');
const { Kafka } = require('kafkajs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/customerdb';
const MONGO_DB = process.env.MONGO_DB || 'customerdb';
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || 'purchases';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || 'purchases';
const KAFKA_GROUP_ID = process.env.KAFKA_GROUP_ID || 'customer-management-group';
const KAFKA_NUM_PARTITIONS = Number(process.env.KAFKA_NUM_PARTITIONS || '1');
const KAFKA_REPLICATION_FACTOR = Number(process.env.KAFKA_REPLICATION_FACTOR || '1');

const kafka = new Kafka({
  clientId: 'customer-management-api',
  brokers: KAFKA_BROKERS,
});

const consumer = kafka.consumer({ groupId: KAFKA_GROUP_ID });
const admin = kafka.admin();
const mongoClient = new MongoClient(MONGO_URI);

// Remarks:
// Writes are strictly append-only and done in one dedicated handler for each Kafka message.
// This keeps the API read-model separate and resilient to web service restarts.
let collection;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrapWithRetry(label, fn, delayMs = 3000) {
  while (true) {
    try {
      await fn();
      return;
    } catch (error) {
      console.error(`Retrying ${label} in ${delayMs / 1000}s...`, error.message);
      await sleep(delayMs);
    }
  }
}

function normalizeRecord(record) {
  const { _id, ...rest } = record;
  return { ...rest, id: rest.id || String(_id), mongoId: String(_id) };
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/purchases', async (req, res) => {
  try {
    const username = req.query.username;
    const filter = {};
    if (username) filter.username = username;

    const items = await collection.find(filter).sort({ timestamp: -1 }).toArray();
    res.json(items.map(normalizeRecord));
  } catch (err) {
    console.error('Error fetching purchases:', err);
    res.status(500).json({ error: 'Could not fetch purchases' });
  }
});

async function onMessage({ topic, partition, message }) {
  let payload;
  try {
    payload = JSON.parse(message.value.toString());
  } catch (error) {
    console.warn('Skipping invalid JSON message from Kafka');
    return;
  }

  try {
    await collection.insertOne({
      ...payload,
      consumedAt: new Date().toISOString(),
      kafkaMeta: { topic, partition, offset: message.offset },
    });
    console.log('Saved purchase:', payload.id || payload.userid);
  } catch (error) {
    console.error('Could not persist message, likely duplicate:', error.message);
  }
}

async function ensureTopic() {
  await admin.connect();
  try {
    const topics = await admin.listTopics();
    if (!topics.includes(KAFKA_TOPIC)) {
      await admin.createTopics({
        topics: [
          {
            topic: KAFKA_TOPIC,
            numPartitions: Math.max(KAFKA_NUM_PARTITIONS, 1),
            replicationFactor: Math.max(KAFKA_REPLICATION_FACTOR, 1),
          },
        ],
        waitForLeaders: true,
      });
      console.log(`Created Kafka topic ${KAFKA_TOPIC}`);
    }
  } finally {
    await admin.disconnect();
  }
}

async function startKafkaConsumer() {
  await consumer.connect();
  await ensureTopic();
  await consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });
  await consumer.run({
    eachMessage: async (messageContext) => {
      await onMessage(messageContext);
    },
  });
}

async function bootstrap() {
  await bootstrapWithRetry('MongoDB connect', () => mongoClient.connect());
  const db = mongoClient.db(MONGO_DB);
  collection = db.collection(MONGO_COLLECTION);

  await collection.createIndex({ username: 1, timestamp: -1 });
  await collection.createIndex({ id: 1 }, { unique: true, sparse: true });

  await bootstrapWithRetry('Kafka consumer', () => startKafkaConsumer());

  app.listen(PORT, () => {
    console.log(`Customer management API listening on ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Could not bootstrap management API:', err);
  process.exit(1);
});
