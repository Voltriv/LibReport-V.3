import React, { useEffect, useMemo, useState } from "react";
import { resolveMediaUrl } from "../api";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  FormHelperText,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Paper,
  Typography,
  Box,
} from "@mui/material";

const GENRE_OPTIONS = [
  "Fiction",
  "Non-fiction",
  "Science",
  "Technology",
  "History",
  "Arts",
  "Education",
  "Reference",
  "Research",
];

const DEPARTMENT_OPTIONS = ["CITE", "CAHS", "CEA", "CMA", "CHTM", "SHS", "CCJE", "CELA"];

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function BookFormModal({
  open,
  mode = "create",             // "create" | "edit"
  book = null,                  // prefill for edit
  onCancel,
  onSubmit,                     // (payload) => Promise<void>
  busy = false,
  serverError = null,
  onClearServerError = () => {},
}) {
  const [formData, setFormData] = useState({
    title: "",
    author: "",
    isbn: "",
    bookCode: "",
    genre: "",
    department: "",
    totalCopies: 1,
    availableCopies: 1,
  });

  // Files
  const [coverFile, setCoverFile] = useState(null);     // image/*
  const [coverPreview, setCoverPreview] = useState(""); // URL string
  const [pdfFile, setPdfFile] = useState(null);         // application/pdf
  const [coverCleared, setCoverCleared] = useState(false);

  const [errors, setErrors] = useState({});

  const normalizeCover = (p) => {
    if (!p) return "";
    const v = String(p).trim();
    if (!v) return "";
    return resolveMediaUrl(v);
  };

  const bookGenre = book?.genre || "";
  const genreOptions = useMemo(() => {
    const merged = new Set(GENRE_OPTIONS);
    if (bookGenre) merged.add(bookGenre);
    if (formData.genre) merged.add(formData.genre);
    return Array.from(merged);
  }, [bookGenre, formData.genre]);

  // Seed state when opening
  useEffect(() => {
    if (!open) return;

    if (mode === "edit" && book) {
      setFormData({
        title: book.title || "",
        author: book.author || "",
        isbn: book.isbn || "",
        bookCode: book.bookCode || "",
        genre: book.genre || "",
        department: book.department || book.genre || "",
        totalCopies: Number(book.totalCopies ?? 1),
        availableCopies: Number(book.availableCopies ?? 1),
      });
      setCoverPreview(normalizeCover(book.coverImagePath || book.coverUrl || ""));
    } else {
      setFormData({
        title: "",
        author: "",
        isbn: "",
        bookCode: "",
        genre: "",
        department: "",
        totalCopies: 1,
        availableCopies: 1,
      });
      setCoverPreview("");
    }

    setCoverCleared(false);
    setCoverFile(null);
    setPdfFile(null);
    setErrors({});
  }, [open, mode, book]);

  // Preview for selected cover
  useEffect(() => {
    if (!coverFile) return;
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const handleChange = (field) => (e) => {
    const value = e.target.value;
    setFormData((p) => ({ ...p, [field]: value }));
    if (errors[field]) setErrors((p) => ({ ...p, [field]: "" }));
    if (serverError) onClearServerError();
  };

  const validate = () => {
    const e = {};
    if (!formData.title.trim()) e.title = "Title is required";
    if (!formData.author.trim()) e.author = "Author is required";
    if (!String(formData.department || "").trim()) e.department = "Department is required";
    if (Number(formData.totalCopies) < 1) e.totalCopies = "At least 1 copy";
    if (
      Number(formData.availableCopies) < 0 ||
      Number(formData.availableCopies) > Number(formData.totalCopies)
    ) {
      e.availableCopies = "0 to Total Copies only";
    }
    if (coverFile && !coverFile.type.startsWith("image/")) e.cover = "Cover must be an image";
    if (pdfFile && pdfFile.type !== "application/pdf") e.pdf = "Attached file must be a PDF";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (!validate() || busy) return;

    const payload = {
      ...formData,
      totalCopies: Number(formData.totalCopies),
      availableCopies: Number(formData.availableCopies),
    };

    if (coverFile) {
      payload.coverImageData = await fileToBase64(coverFile);
      payload.coverImageName = coverFile.name;
    } else if (coverCleared && mode === "edit") {
      payload.coverRemoved = true;
    }

    if (pdfFile) {
      payload.pdfData = await fileToBase64(pdfFile);
      payload.pdfName = pdfFile.name;
    }

    await onSubmit(payload);
  };

  const cancel = () => {
    setCoverFile(null);
    setPdfFile(null);
    setCoverPreview("");
    setCoverCleared(false);
    setErrors({});
    onCancel?.();
  };

  return (
    <Dialog open={open} onClose={cancel} maxWidth="md" fullWidth>
      <DialogTitle>{mode === "create" ? "Add New Book" : "Edit Book"}</DialogTitle>

      <form onSubmit={submit}>
        <DialogContent>
          <Stack spacing={3}>
            {/* Main Fields */}
            <Stack spacing={2}>
              <TextField
                label="Title *"
                value={formData.title}
                onChange={handleChange("title")}
                error={!!errors.title}
                helperText={errors.title}
                fullWidth
                autoFocus
              />
              <TextField
                label="Author *"
                value={formData.author}
                onChange={handleChange("author")}
                error={!!errors.author}
                helperText={errors.author}
                fullWidth
              />
              <TextField label="ISBN" value={formData.isbn} onChange={handleChange("isbn")} fullWidth />
              <TextField
                label="Book Code"
                value={formData.bookCode}
                onChange={handleChange("bookCode")}
                fullWidth
              />
              <FormControl fullWidth>
                <InputLabel>Genre</InputLabel>
                <Select label="Genre" value={formData.genre} onChange={handleChange("genre")}>
                  <MenuItem value="">
                    <em>Select a genre</em>
                  </MenuItem>
                  {genreOptions.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth error={!!errors.department}>
                <InputLabel>Department</InputLabel>
                <Select
                  label="Department"
                  value={formData.department}
                  onChange={handleChange("department")}
                >
                  <MenuItem value="">
                    <em>Select a department</em>
                  </MenuItem>
                  {DEPARTMENT_OPTIONS.map((dep) => (
                    <MenuItem key={dep} value={dep}>
                      {dep}
                    </MenuItem>
                  ))}
                </Select>
                {errors.department && <FormHelperText>{errors.department}</FormHelperText>}
              </FormControl>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Total Copies"
                  type="number"
                  inputProps={{ min: 1 }}
                  value={formData.totalCopies}
                  onChange={handleChange("totalCopies")}
                  error={!!errors.totalCopies}
                  helperText={errors.totalCopies}
                  fullWidth
                />
                <TextField
                  label="Available Copies"
                  type="number"
                  inputProps={{ min: 0, max: formData.totalCopies }}
                  value={formData.availableCopies}
                  onChange={handleChange("availableCopies")}
                  error={!!errors.availableCopies}
                  helperText={errors.availableCopies}
                  fullWidth
                />
              </Stack>
            </Stack>

            {/* Uploads */}
            <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
              {/* Cover Photo */}
              <Stack spacing={1} sx={{ flex: 1 }}>
                <Typography variant="subtitle2">Cover Photo</Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Box
                    sx={{
                      width: "100%",
                      height: 260,
                      borderRadius: 1,
                      bgcolor: "grey.100",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {coverPreview ? (
                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                      <img
                        src={coverPreview}
                        alt="Cover preview"
                        onError={() => setCoverPreview("")}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No image selected
                      </Typography>
                    )}
                  </Box>

                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                    <Button variant="outlined" component="label">
                      Choose Image
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const nextFile = e.target.files?.[0] || null;
                          setCoverFile(nextFile);
                          setCoverCleared(false);
                          if (serverError) onClearServerError();
                        }}
                      />
                    </Button>
                    {coverPreview && (
                      <Button
                        variant="text"
                        color="inherit"
                        onClick={() => {
                          setCoverFile(null);
                          setCoverPreview("");
                          setCoverCleared(true);
                          if (serverError) onClearServerError();
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </Stack>
                  {errors.cover && (
                    <Typography variant="caption" color="error" sx={{ mt: 1, display: "block" }}>
                      {errors.cover}
                    </Typography>
                  )}
                </Paper>
              </Stack>

              {/* PDF File */}
              <Stack spacing={1} sx={{ flex: 1 }}>
                <Typography variant="subtitle2">Attach File (PDF)</Typography>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Button variant="outlined" component="label">
                      Choose PDF
                      <input
                        hidden
                        type="file"
                        accept="application/pdf"
                        onChange={(e) => { setPdfFile(e.target.files?.[0] || null); if (serverError) onClearServerError(); }}
                      />
                    </Button>
                    <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 260 }}>
                      {pdfFile?.name || "No file selected"}
                    </Typography>
                  </Stack>
                  {errors.pdf && (
                    <Typography variant="caption" color="error" sx={{ mt: 1, display: "block" }}>
                      {errors.pdf}
                    </Typography>
                  )}
                </Paper>
              </Stack>
            </Stack>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? "Saving..." : mode === "create" ? "Add Book" : "Update Book"}
          </Button>
        </DialogActions>
      </form>

      {/* Centered server error overlay inside modal */}
      {serverError && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 1400,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Paper
            elevation={6}
            sx={{
              px: 2.5,
              py: 1.5,
              borderRadius: 2,
              bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(127,29,29,0.2)' : 'rgba(254,226,226,0.9)'),
              color: (t) => (t.palette.mode === 'dark' ? '#fecaca' : '#7f1d1d'),
              border: '1px solid',
              borderColor: 'error.light',
              pointerEvents: 'auto',
            }}
          >
            <Typography variant="body2" fontWeight={600}>{serverError}</Typography>
          </Paper>
        </Box>
      )}
    </Dialog>
  );
}


