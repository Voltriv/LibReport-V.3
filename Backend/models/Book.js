const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    isbn: { type: String, trim: true },
    bookCode: { type: String, trim: true },
    department: { type: String, trim: true },
    genre: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    totalCopies: { type: Number, default: 1, min: 0 },
    availableCopies: { type: Number, default: 1, min: 0 },
    coverImagePath: { type: String, trim: true },
    coverImageOriginalName: { type: String, trim: true },
    coverImageFileId: { type: mongoose.Schema.Types.ObjectId },
    coverImageMime: { type: String, trim: true },
    pdfPath: { type: String, trim: true },
    pdfOriginalName: { type: String, trim: true },
    pdfFileId: { type: mongoose.Schema.Types.ObjectId },
    pdfMime: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Book', bookSchema);

