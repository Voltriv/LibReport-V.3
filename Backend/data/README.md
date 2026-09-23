Books CSV Template
==================

Use `books.template.csv` as a starting point. Keep the header row intact.

Columns
- title (required)
- author (required)
- isbn (optional)
- bookCode (optional, unique if used)
- genre (optional)
- tags (optional, use | or , separators)
- totalCopies (optional, default 1)
- availableCopies (optional, defaults to totalCopies)
- coverImageFile (optional, PNG/JPG/WEBP cover image to upload)
- pdfFile (optional, PDF file to upload alongside the record)

Optional advanced columns
- coverImageName (override stored cover filename; defaults to source file name)
- coverImageMime (override detected MIME type; must be image/png, image/jpeg, or image/webp)
- pdfName (override stored PDF filename; defaults to source file name)
- pdfMime (override detected MIME type; must be application/pdf)

Import commands (run from repo root)
- Dry run: `npm --prefix Backend run import:books -- data/books.template.csv --dry-run`
- Import:  `npm --prefix Backend run import:books -- data/books.template.csv`

Tips
- Upsert order: bookCode > isbn > title+author.
- You can replace this file with your full list (e.g., 500+ rows).
- Relative paths in `coverImageFile` / `pdfFile` are resolved from the CSV file location. Place assets next to the CSV (e.g., `Backend/data/assets/...`). The importer uploads them into MongoDB GridFS and updates `coverImagePath` / `pdfPath` automatically.
- Dry runs validate that files exist without uploading anything, so use them to check path typos before running a real import.

