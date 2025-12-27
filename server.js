import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const SPEEDY_BASE = "https://api.speedy.bg/v1";

// ----------------------
// Helpers
// ----------------------
function authEnvelope(extraBody) {
  return {
    userName: process.env.SPEEDY_USERNAME,
    password: process.env.SPEEDY_PASSWORD,
    language: "BG",
    ...(extraBody || {}),
  };
}

async function speedyPostJson(path, body) {
  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authEnvelope(body)),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { ok: res.ok, status: res.status, json, raw: text };
}

async function speedyPostPdf(path, body) {
  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authEnvelope(body)),
  });

  const ct = res.headers.get("content-type") || "";

  // Ако Speedy върне грешка като JSON/text
  if (!ct.includes("application/pdf")) {
    const text = await res.text();
    return { ok: false, status: res.status, raw: text, contentType: ct };
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  return { ok: res.ok, status: res.status, pdf: buf, contentType: ct };
}

// ----------------------
// Health
// ----------------------
app.get("/", (req, res) => {
  res.type("text").send("OK: speedy-api proxy is live ✅");
});

// ======================================================
// ✅ Office & site lookup (както си го имал)
// GET /sites?name=София
// GET /offices?siteId=68134
// ======================================================
app.get("/sites", async (req, res) => {
  const name = String(req.query.name || "");

  const result = await speedyPostJson("/location/site/", {
    countryId: 100,
    name,
  });

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy error",
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json?.sites || []);
});

app.get("/offices", async (req, res) => {
  const siteId = Number(req.query.siteId || 0);
  if (!siteId) return res.status(400).json({ error: "Missing siteId" });

  const result = await speedyPostJson("/location/office/", { siteId });

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy error",
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json?.offices || []);
});

// ======================================================
// ✅ Speedy-like endpoints (за да е 1:1 API стил)
// POST /location/site     -> calls /location/site/
// POST /location/office   -> calls /location/office/
// ======================================================
app.post("/location/site", async (req, res) => {
  const result = await speedyPostJson("/location/site/", req.body);

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy location/site failed",
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

app.post("/location/office", async (req, res) => {
  const result = await speedyPostJson("/location/office/", req.body);

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy location/office failed",
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

// ======================================================
// ✅ MAIN: shipment + print (Speedy-compatible)
// Cloudflare Worker should call:
//   POST /shipment
//   POST /print
// ======================================================
app.post("/shipment", async (req, res) => {
  const result = await speedyPostJson("/shipment/", req.body);

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy shipment failed",
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

app.post("/print", async (req, res) => {
  const result = await speedyPostPdf("/print/", req.body);

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy print failed",
      details: result.raw || "",
      contentType: result.contentType || "",
    });
  }

  res.setHeader("Content-Type", "application/pdf");
  return res.send(result.pdf);
});

// ======================================================
// ✅ Backwards compat (ако Worker-а ти още вика /createShipment)
// ======================================================
app.post("/createShipment", async (req, res) => {
  // alias към /shipment
  const result = await speedyPostJson("/shipment/", req.body);

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy createShipment failed",
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
