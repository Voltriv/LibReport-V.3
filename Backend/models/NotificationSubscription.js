const mongoose = require('mongoose');

const notificationSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true }
    },
    userAgent: { type: String, default: '' },
    lastUsedAt: { type: Date, default: null },
    blockedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

notificationSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });

module.exports = mongoose.model('NotificationSubscription', notificationSubscriptionSchema);

