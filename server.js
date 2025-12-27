import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const SPEEDY_BASE = "https://api.speedy.bg/v1";

// ----------------------
// Helpers
// ----------------------
async function speedyPostRaw(path, body) {
  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { ok: res.ok, status: res.status, contentType: ct, raw: text, json };
}

async function speedyPostPdf(path, body) {
  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  const ct = res.headers.get("content-type") || "";

  // ако Speedy върне грешка като JSON/text
  if (!ct.includes("application/pdf")) {
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: false, status: res.status, contentType: ct, raw: text, json };
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  return { ok: res.ok, status: res.status, contentType: ct, pdf: buf };
}

// ----------------------
// Health
// ----------------------
app.get("/", (req, res) => {
  res.type("text").send("OK: speedy-api proxy is live ✅");
});

// ----------------------
// GET /sites?name=София  (удобен shortcut)
// ----------------------
app.get("/sites", async (req, res) => {
  const name = String(req.query.name || "");

  // Worker ще прати user/pass normally, но за GET shortcut-а
  // очакваме да ги имаш в query или да не го ползваш от UI.
  // Реално: най-добре ползвай POST /location/site от Worker.
  return res.status(400).json({
    error: "Use POST /location/site with credentials in body. GET /sites is disabled to avoid credential leaks.",
  });
});

// ----------------------
// GET /offices?siteId=... (удобен shortcut)
// ----------------------
app.get("/offices", async (req, res) => {
  return res.status(400).json({
    error: "Use POST /location/office with credentials in body. GET /offices is disabled to avoid credential leaks.",
  });
});

// ======================================================
// 1:1 proxy endpoints (Worker calls these)
// ======================================================

// Speedy location site
app.post("/location/site", async (req, res) => {
  const result = await speedyPostRaw("/location/site/", req.body);

  // IMPORTANT: Speedy понякога връща 200 + error вътре
  if (!result.ok || result.json?.error || result.json?.errors) {
    return res.status(result.status || 500).json({
      error: "Speedy location/site failed",
      status: result.status,
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

// Speedy location office
app.post("/location/office", async (req, res) => {
  const result = await speedyPostRaw("/location/office/", req.body);

  if (!result.ok || result.json?.error || result.json?.errors) {
    return res.status(result.status || 500).json({
      error: "Speedy location/office failed",
      status: result.status,
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

// Create shipment
app.post("/shipment", async (req, res) => {
  const result = await speedyPostRaw("/shipment/", req.body);

  if (!result.ok || result.json?.error || result.json?.errors) {
    return res.status(result.status || 500).json({
      error: "Speedy shipment failed",
      status: result.status,
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

// Print PDF
app.post("/print", async (req, res) => {
  const result = await speedyPostPdf("/print/", req.body);

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy print failed",
      status: result.status,
      contentType: result.contentType,
      details: result.raw || "",
      json: result.json || null,
    });
  }

  res.setHeader("Content-Type", "application/pdf");
  return res.send(result.pdf);
});

// Backward compat (ако някъде още викаш /createShipment)
app.post("/createShipment", async (req, res) => {
  const result = await speedyPostRaw("/shipment/", req.body);

  if (!result.ok || result.json?.error || result.json?.errors) {
    return res.status(result.status || 500).json({
      error: "Speedy createShipment failed",
      status: result.status,
      details: result.raw,
      json: result.json || null,
    });
  }

  return res.json(result.json);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
