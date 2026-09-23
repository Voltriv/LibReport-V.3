const mongoose = require('mongoose');

const hoursSchema = new mongoose.Schema(
  {
    branch: { type: String, required: true, trim: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    open: { type: String, required: true },
    close: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Hours', hoursSchema);

