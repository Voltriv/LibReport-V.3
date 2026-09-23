const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    studentId: { type: String, trim: true },
    barcode: { type: String, trim: true },
    branch: { type: String, trim: true, default: 'Main' },
    enteredAt: { type: Date, default: () => new Date() },
    exitedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Visit', visitSchema);

