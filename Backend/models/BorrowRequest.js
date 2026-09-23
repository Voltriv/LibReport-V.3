const mongoose = require('mongoose');

const STATUS_VALUES = ['pending', 'approved', 'rejected', 'cancelled'];

const borrowRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    status: { type: String, enum: STATUS_VALUES, default: 'pending' },
    requestType: { type: String, enum: ['borrow', 'renewal'], default: 'borrow' },
    daysRequested: { type: Number, default: null },
    message: { type: String, default: '' },
    adminNote: { type: String, default: '' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    processedAt: { type: Date, default: null },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', default: null },
    dueAt: { type: Date, default: null }
  },
  { timestamps: true }
);

borrowRequestSchema.index({ userId: 1, bookId: 1, requestType: 1, status: 1 });
borrowRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('BorrowRequest', borrowRequestSchema);
