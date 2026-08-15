const express = require('express');
const multer = require('multer');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { createExtractorFromData } = require('node-unrar-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 150 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          if (ext === '.cbr' || ext === '.rar') return cb(null, true);
          cb(new Error('Only .cbr / .rar files are accepted'));
    },
});

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

app.post('/convert', upload.single('cbr'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
          const extractor = await createExtractorFromData({ data: req.file.buffer });
          const extracted = extractor.extract();
          const imageFiles = [];
          for (const file of extracted.files) {
                  if (file.fileHeader.flags.directory) continue;
                  const ext = path.extname(file.fileHeader.name).toLowerCase();
                  if (!IMAGE_EXTS.has(ext)) continue;
                  imageFiles.push({ name: file.fileHeader.name, data: file.extraction, ext });
          }
          if (imageFiles.length === 0) return res.status(422).json({ error: 'No images found inside the CBR file.' });
          imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
          const pdfDoc = await PDFDocument.create();
          for (const imgFile of imageFiles) {
                  let imgBytes = imgFile.data;
                  if (!imgBytes) continue;
                  if (!(imgBytes instanceof Uint8Array)) imgBytes = new Uint8Array(imgBytes);
                  let embeddedImg;
                  try {
                            if (imgFile.ext === '.png') embeddedImg = await pdfDoc.embedPng(imgBytes);
                            else embeddedImg = await pdfDoc.embedJpg(imgBytes);
                  } catch { continue; }
                  const { width, height } = embeddedImg;
                  const page = pdfDoc.addPage([width, height]);
                  page.drawImage(embeddedImg, { x: 0, y: 0, width, height });
          }
          if (pdfDoc.getPageCount() === 0) return res.status(422).json({ error: 'Could not embed any images.' });
          const pdfBytes = await pdfDoc.save();
          const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
          res.send(Buffer.from(pdfBytes));
    } catch (err) {
          console.error(err);
          res.status(500).json({ error: `Conversion failed: ${err.message}` });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
