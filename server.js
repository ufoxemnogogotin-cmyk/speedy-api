import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const SPEEDY_BASE = "https://api.speedy.bg/v1";

// ----------------------
// JSON helper (standard Speedy call)
// ----------------------
async function speedyPostJson(path, body) {
  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userName: process.env.SPEEDY_USERNAME,
      password: process.env.SPEEDY_PASSWORD,
      language: "BG",
      ...body,
    }),
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

// ----------------------
// PDF helper (Speedy print -> PDF)
// ----------------------
async function speedyPostPdf(path, body) {
  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userName: process.env.SPEEDY_USERNAME,
      password: process.env.SPEEDY_PASSWORD,
      language: "BG",
      ...body,
    }),
  });

  const ct = res.headers.get("content-type") || "";

  // ако Speedy върне грешка като JSON/text
  if (!ct.includes("application/pdf")) {
    const text = await res.text();
    return { ok: false, status: res.status, raw: text };
  }

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  return { ok: res.ok, status: res.status, pdf: buf };
}

// ----------------------
// Health
// ----------------------
app.get("/", (req, res) => {
  res.type("text").send("OK: speedy-api proxy is live ✅");
});

// ----------------------
// EXISTING: GET /sites?name=София
// ----------------------
app.get("/sites", async (req, res) => {
  const name = req.query.name || "";

  const result = await speedyPostJson("/location/site/", {
    countryId: 100,
    name,
  });

  if (!result.ok) {
    return res.status(result.status).json({
      error: "Speedy error",
      details: result.raw,
    });
  }

  res.json(result.json?.sites || []);
});

// ----------------------
// EXISTING: GET /offices?siteId=68134
// ----------------------
app.get("/offices", async (req, res) => {
  const siteId = Number(req.query.siteId || 0);
  if (!siteId) return res.status(400).json({ error: "Missing siteId" });

  const result = await speedyPostJson("/location/office/", { siteId });

  if (!result.ok) {
    return res.status(result.status).json({
      error: "Speedy error",
      details: result.raw,
    });
  }

  res.json(result.json?.offices || []);
});

// ======================================================
// ✅ NEW: POST /createShipment
// Cloudflare Worker ще POST-ва payload за shipment тук
// ======================================================
app.post("/createShipment", async (req, res) => {
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

// ======================================================
// ✅ NEW: POST /print
// Cloudflare Worker ще POST-ва print request тук
// ======================================================
app.post("/print", async (req, res) => {
  const result = await speedyPostPdf("/print/", req.body);

  if (!result.ok) {
    return res.status(result.status || 500).json({
      error: "Speedy print failed",
      details: result.raw || "",
    });
  }

  res.setHeader("Content-Type", "application/pdf");
  return res.send(result.pdf);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
