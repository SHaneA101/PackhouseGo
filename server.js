const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8000;
const DATA_FILE = path.join(__dirname, "data.json");
const UPLOADS_ROOT = path.join(__dirname, "uploads");
const MRL_UPLOAD_DIR = path.join(UPLOADS_ROOT, "mrl");
const INTERNAL_UPLOAD_DIR = path.join(UPLOADS_ROOT, "internal");

app.use(express.json({ limit: "15mb" }));
app.use(express.static(__dirname));
app.use("/uploads", express.static(UPLOADS_ROOT));
app.get("/manifest.webmanifest", (_req, res) => {
  res.type("application/manifest+json");
  res.sendFile(path.join(__dirname, "manifest.webmanifest"));
});
app.get("/sw.js", (_req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "sw.js"));
});

function defaultData() {
  return {
    users: [
      {
        id: "u-admin",
        name: "Packhouse Admin",
        email: "admin@packhouse.local",
        password: "admin123",
        role: "admin",
        farm: "Main Packhouse",
        commodities: ["citrus", "stone"]
      }
    ],
    batches: [],
    qc: [],
    updates: [],
    forecast: [],
    mrls: [],
    internalResults: []
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2), "utf8");
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const merged = { ...defaultData(), ...parsed };
    fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), "utf8");
  } catch (_err) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2), "utf8");
  }
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
    farm: user.farm,
    commodities: user.commodities
  };
}

function findFarmerProfile(data, farmerName) {
  const normalized = String(farmerName || "").trim().toLowerCase();
  return (data.users || []).find(
    (u) => u.role === "farmer" && String(u.name || "").trim().toLowerCase() === normalized
  );
}

function safeName(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function parseDataUrl(input) {
  const value = String(input || "");
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function saveUploadFile(targetDir, originalFileName, base64Data) {
  const ext = path.extname(originalFileName) || ".bin";
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filePath = path.join(targetDir, storedName);
  fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
  return storedName;
}

ensureDataFile();
fs.mkdirSync(MRL_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(INTERNAL_UPLOAD_DIR, { recursive: true });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const data = readData();
  const user = data.users.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.password === password
  );
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  res.json({ user: sanitizeUser(user) });
});

app.post("/api/register", (req, res) => {
  const { name, farm, email, password, commodities } = req.body || {};
  if (!name || !farm || !email || !password) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  if (!Array.isArray(commodities) || !commodities.length) {
    return res.status(400).json({ error: "Select at least one commodity." });
  }

  const data = readData();
  const normalizedEmail = String(email).trim().toLowerCase();
  if (data.users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: "Email already exists." });
  }

  const user = {
    id: `u-${Date.now()}`,
    name: String(name).trim(),
    farm: String(farm).trim(),
    email: normalizedEmail,
    password: String(password),
    role: "farmer",
    commodities
  };
  data.users.push(user);
  writeData(data);
  res.status(201).json({ user: sanitizeUser(user) });
});

app.get("/api/farmers", (_req, res) => {
  const data = readData();
  const farmers = (data.users || [])
    .filter((u) => u.role === "farmer")
    .map((u) => ({ id: u.id, name: u.name, farm: u.farm, email: u.email }));
  res.json(farmers);
});

app.get("/api/users", (_req, res) => {
  const data = readData();
  const users = (data.users || []).map((u) => ({
    id: u.id,
    name: u.name,
    farm: u.farm || "",
    email: u.email,
    role: u.role || "farmer"
  }));
  res.json(users);
});

app.get("/api/batches", (_req, res) => {
  const data = readData();
  res.json(data.batches);
});

app.post("/api/batches", (req, res) => {
  const { farmer, fruitType, variety, bins, grade } = req.body || {};
  if (!farmer || !fruitType || !variety || !bins || !grade) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  const data = readData();
  const profile = findFarmerProfile(data, farmer);
  const batch = {
    id: `B${Date.now()}`,
    farmer: String(farmer).trim(),
    farm: profile ? String(profile.farm || "").trim() : "",
    fruitType: String(fruitType),
    variety: String(variety).trim(),
    bins: Number(bins),
    grade: String(grade),
    status: "qc_pending",
    createdAt: new Date().toISOString()
  };
  data.batches.unshift(batch);
  writeData(data);
  res.status(201).json(batch);
});

app.patch("/api/batches/:id/status", (req, res) => {
  const { status } = req.body || {};
  const { id } = req.params;
  if (!status) return res.status(400).json({ error: "Status is required." });
  const data = readData();
  const batch = data.batches.find((b) => b.id === id);
  if (!batch) return res.status(404).json({ error: "Batch not found." });
  batch.status = String(status);
  writeData(data);
  res.json(batch);
});

app.get("/api/qc", (_req, res) => {
  const data = readData();
  res.json(data.qc);
});

app.post("/api/qc", (req, res) => {
  const { batchId, farmer, defect, decision, rejectionReason } = req.body || {};
  if ((!batchId && !farmer) || defect === undefined || !decision) {
    return res.status(400).json({ error: "Batch or farmer, defect, and decision are required." });
  }
  if (String(decision) !== "pass" && !String(rejectionReason || "").trim()) {
    return res.status(400).json({ error: "Rejected reason is required." });
  }
  const data = readData();
  const batch = batchId ? data.batches.find((b) => b.id === batchId) : null;
  if (batchId && !batch) return res.status(404).json({ error: "Batch not found." });
  if (batch) {
    batch.status = decision === "pass" ? "ready_to_pack" : "qc_hold";
  }
  const profile = findFarmerProfile(data, farmer || (batch && batch.farmer) || "");
  const row = {
    batchId: batch ? batch.id : "",
    farmer: batch ? batch.farmer : String(farmer).trim(),
    farm: batch ? (batch.farm || "") : (profile ? String(profile.farm || "").trim() : ""),
    fruitType: batch ? batch.fruitType : "",
    defect: Number(defect),
    decision: String(decision),
    rejectionReason: String(rejectionReason || "").trim(),
    timestamp: new Date().toISOString()
  };
  data.qc.unshift(row);
  writeData(data);
  res.status(201).json(row);
});

app.get("/api/updates", (_req, res) => {
  const data = readData();
  res.json(data.updates);
});

app.post("/api/updates", (req, res) => {
  const { farmer, message, sentBy, source } = req.body || {};
  if (!farmer || !message) {
    return res.status(400).json({ error: "Farmer and message are required." });
  }
  const data = readData();
  const row = {
    farmer: String(farmer),
    message: String(message),
    sentBy: sentBy ? String(sentBy) : "Unknown",
    source: source ? String(source) : "admin_to_farmer",
    timestamp: new Date().toISOString()
  };
  data.updates.unshift(row);
  writeData(data);
  res.status(201).json(row);
});

app.get("/api/forecast", (_req, res) => {
  const data = readData();
  res.json(data.forecast);
});

app.post("/api/forecast", (req, res) => {
  const { week, fruitType, farmer, tons, submittedBy, submittedByRole } = req.body || {};
  if (!week || !fruitType || !farmer || !tons) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  const data = readData();
  const row = {
    week: String(week),
    fruitType: String(fruitType),
    farmer: String(farmer).trim(),
    tons: Number(tons),
    submittedBy: submittedBy ? String(submittedBy).trim() : String(farmer).trim(),
    submittedByRole: submittedByRole ? String(submittedByRole).trim() : "admin",
    timestamp: new Date().toISOString()
  };
  data.forecast.unshift(row);
  writeData(data);
  res.status(201).json(row);
});

app.get("/api/mrls", (_req, res) => {
  const data = readData();
  res.json(data.mrls || []);
});

app.post("/api/mrls", (req, res) => {
  const { farmer, fileName, fileData, note, uploadedBy } = req.body || {};
  if (!farmer || !fileName || !fileData) {
    return res.status(400).json({ error: "Farmer, file name, and file data are required." });
  }

  const parsed = parseDataUrl(fileData);
  if (!parsed || !parsed.base64) {
    return res.status(400).json({ error: "Invalid file format. Upload a valid file." });
  }

  const originalFileName = safeName(path.basename(String(fileName))) || "mrl_file";

  let storedName;
  try {
    storedName = saveUploadFile(MRL_UPLOAD_DIR, originalFileName, parsed.base64);
  } catch (_err) {
    return res.status(500).json({ error: "Could not store file." });
  }

  const data = readData();
  const profile = findFarmerProfile(data, farmer);
  const row = {
    id: `mrl-${Date.now()}`,
    farmer: String(farmer).trim(),
    farm: profile ? String(profile.farm || "").trim() : "",
    fileName: originalFileName,
    url: `/uploads/mrl/${storedName}`,
    note: note ? String(note).trim() : "",
    uploadedBy: uploadedBy ? String(uploadedBy).trim() : "Unknown",
    mimeType: parsed.mimeType,
    timestamp: new Date().toISOString()
  };

  data.mrls = Array.isArray(data.mrls) ? data.mrls : [];
  data.mrls.unshift(row);
  writeData(data);
  res.status(201).json(row);
});

app.get("/api/internal-results", (_req, res) => {
  const data = readData();
  res.json(data.internalResults || []);
});

app.post("/api/internal-results", (req, res) => {
  const { farmer, fileName, fileData, note, uploadedBy, batchId } = req.body || {};
  if (!farmer || !fileName || !fileData) {
    return res.status(400).json({ error: "Farmer, file name, and file data are required." });
  }

  const parsed = parseDataUrl(fileData);
  if (!parsed || !parsed.base64) {
    return res.status(400).json({ error: "Invalid file format. Upload a valid camera image." });
  }

  const originalFileName = safeName(path.basename(String(fileName))) || "internal_result.jpg";

  let storedName;
  try {
    storedName = saveUploadFile(INTERNAL_UPLOAD_DIR, originalFileName, parsed.base64);
  } catch (_err) {
    return res.status(500).json({ error: "Could not store file." });
  }

  const data = readData();
  const profile = findFarmerProfile(data, farmer);
  const row = {
    id: `internal-${Date.now()}`,
    farmer: String(farmer).trim(),
    farm: profile ? String(profile.farm || "").trim() : "",
    batchId: batchId ? String(batchId).trim() : "",
    fileName: originalFileName,
    url: `/uploads/internal/${storedName}`,
    note: note ? String(note).trim() : "",
    uploadedBy: uploadedBy ? String(uploadedBy).trim() : "Unknown",
    mimeType: parsed.mimeType,
    timestamp: new Date().toISOString()
  };

  data.internalResults = Array.isArray(data.internalResults) ? data.internalResults : [];
  data.internalResults.unshift(row);
  writeData(data);
  res.status(201).json(row);
});

app.listen(PORT, () => {
  console.log(`PackhouseGo server running on http://localhost:${PORT}`);
});
