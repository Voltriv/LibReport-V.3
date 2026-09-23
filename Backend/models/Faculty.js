const mongoose = require('mongoose');
const validator = require('validator');
const { STUDENT_ID_REGEX } = require('./validators');

const facultySchema = new mongoose.Schema(
  {
    facultyId: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => STUDENT_ID_REGEX.test(v),
        message: 'Faculty ID must match 00-0000-000000 pattern'
      }
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      // Convert "" (or whitespace-only) to undefined so it won't be indexed
      set: (v) => (v && v.trim() ? v : undefined),
      validate: {
        validator: (v) => !v || validator.isEmail(v),
        message: 'Email must be a valid address'
      }
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => /^[A-Za-z .'-]+$/.test(v),
        message:
          "Full name may contain letters, spaces, apostrophes, hyphens, and periods only"
      }
    },
    department: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active'
    }
  },
  {
    timestamps: true,
    collection: 'faculty'
  }
);

// Indexes
facultySchema.index({ facultyId: 1 }, { unique: true });

// Use a partial index to only index real string emails (no empty values).
facultySchema.index(
  { email: 1 },
  {
    unique: true,
    // `sparse` is unnecessary when using a partial index; the filter controls inclusion.
    partialFilterExpression: { email: { $exists: true, $type: 'string' } }
  }
);

facultySchema.index({ department: 1, status: 1 });

module.exports = mongoose.model('Faculty', facultySchema);
