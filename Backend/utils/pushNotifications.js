const mongoose = require('mongoose');
const { NotificationSubscription } = require('../models');

const contactEmail = process.env.WEB_PUSH_CONTACT_EMAIL || 'mailto:admin@libreport.local';
const vapidPublicKey = process.env.WEB_PUSH_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.WEB_PUSH_PRIVATE_KEY || '';

let webpush = null;
try {
  // eslint-disable-next-line global-require
  webpush = require('web-push');
} catch (err) {
  console.warn('[push] Optional dependency "web-push" not installed. Push notifications disabled.');
}

let webPushEnabled = false;

try {
  if (webpush && vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(contactEmail, vapidPublicKey, vapidPrivateKey);
    webPushEnabled = true;
  } else {
    console.warn(
      '[push] Web push is disabled because required keys are not set or "web-push" is unavailable.'
    );
  }
} catch (err) {
  webPushEnabled = false;
  console.error('[push] Failed to configure web-push:', err?.message || err);
}

function isConfigured() {
  return webPushEnabled;
}

function getPublicKey() {
  return webPushEnabled ? vapidPublicKey : '';
}

function normalizeSubscriptionPayload(body = {}) {
  if (!body || typeof body !== 'object') return null;
  const { endpoint, keys, userAgent } = body;
  const auth = keys?.auth;
  const p256dh = keys?.p256dh;
  if (!endpoint || !auth || !p256dh) return null;
  return {
    endpoint: String(endpoint),
    keys: {
      auth: String(auth),
      p256dh: String(p256dh)
    },
    userAgent: userAgent ? String(userAgent).slice(0, 512) : ''
  };
}

async function upsertSubscription({ userId, body }) {
  if (!webPushEnabled) {
    return { ok: false, reason: 'disabled' };
  }
  if (!mongoose.Types.ObjectId.isValid(String(userId))) {
    return { ok: false, reason: 'invalid-user' };
  }
  const normalized = normalizeSubscriptionPayload(body);
  if (!normalized) {
    return { ok: false, reason: 'invalid-subscription' };
  }

  const update = {
    $set: {
      keys: normalized.keys,
      userAgent: normalized.userAgent,
      blockedAt: null
    },
    $setOnInsert: { userId: new mongoose.Types.ObjectId(String(userId)) }
  };

  await NotificationSubscription.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(String(userId)), endpoint: normalized.endpoint },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { ok: true };
}

async function removeSubscription({ userId, endpoint }) {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) return;
  if (!endpoint) return;
  await NotificationSubscription.deleteOne({
    userId: new mongoose.Types.ObjectId(String(userId)),
    endpoint: String(endpoint)
  });
}

async function sendPushNotification(subscriptionDoc, payload) {
  if (!webPushEnabled || !webpush) return;
  if (!subscriptionDoc) return;
  try {
    const notificationPayload = JSON.stringify(payload);
    await webpush.sendNotification(
      {
        endpoint: subscriptionDoc.endpoint,
        keys: subscriptionDoc.keys
      },
      notificationPayload
    );
    await NotificationSubscription.updateOne(
      { _id: subscriptionDoc._id },
      { $set: { lastUsedAt: new Date(), blockedAt: null } }
    );
  } catch (err) {
    const statusCode = err?.statusCode || err?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await NotificationSubscription.deleteOne({ _id: subscriptionDoc._id });
    } else {
      await NotificationSubscription.updateOne(
        { _id: subscriptionDoc._id },
        { $set: { blockedAt: new Date() } }
      );
      console.error('[push] Failed to send notification:', err?.message || err);
    }
  }
}

async function sendNotificationToUser(userId, payload) {
  if (!webPushEnabled) return;
  if (!mongoose.Types.ObjectId.isValid(String(userId))) return;
  const subscriptions = await NotificationSubscription.find({
    userId: new mongoose.Types.ObjectId(String(userId)),
    blockedAt: null
  }).lean();
  if (!subscriptions.length) return;
  await Promise.all(subscriptions.map((sub) => sendPushNotification(sub, payload)));
}

module.exports = {
  isConfigured,
  getPublicKey,
  upsertSubscription,
  removeSubscription,
  sendNotificationToUser
};
