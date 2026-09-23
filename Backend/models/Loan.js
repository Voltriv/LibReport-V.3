const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    borrowedAt: { type: Date, default: () => new Date() },
    dueAt: { type: Date, required: true },
    returnedAt: { type: Date, default: null },
    overdueNotifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Loan', loanSchema);
