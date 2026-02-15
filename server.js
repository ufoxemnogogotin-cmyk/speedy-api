import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const SPEEDY_BASE = "https://api.speedy.bg/v1";

// Speedy accepts ONLY: RECIPIENT, SENDER, THIRD_PARTY
function normalizeCourierServicePayer(v) {
  const s = String(v || "").toUpperCase().trim();

  if (s === "RECIPIENT" || s === "SENDER" || s === "THIRD_PARTY") return s;

  // legacy/wrong values we've seen
  if (s === "CONTRACT_CLIENT" || s === "CONTRACTCLIENT" || s === "CLIENT") return "SENDER";

  // safest default
  return "SENDER";
}

async function speedyPost(path, body) {
  if (!process.env.SPEEDY_USERNAME || !process.env.SPEEDY_PASSWORD) {
    return {
      status: 500,
      json: null,
      raw: "Missing SPEEDY_USERNAME / SPEEDY_PASSWORD env vars on Render.",
      headers: {},
    };
  }

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
  const text = await res.text();

  // If Speedy returns PDF or non-JSON, keep raw
  let json = null;
  if (ct.includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  } else {
    // sometimes Speedy returns JSON but without header; try parse anyway
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { status: res.status, json, raw: text, headers: { "content-type": ct } };
}

// ✅ health
app.get("/", (req, res) => {
  res.type("text").send("OK LIVE");
});

// GET /sites?name=София
app.get("/sites", async (req, res) => {
  const name = req.query.name || "";

  const result = await speedyPost("/location/site/", {
    countryId: 100,
    name,
  });

  if (result.status !== 200) {
    return res.status(result.status).json({
      ok: false,
      status: result.status,
      error: "Speedy error",
      details: result.raw,
    });
  }

  res.json(result.json?.sites || []);
});

// GET /offices?siteId=68134
app.get("/offices", async (req, res) => {
  const siteId = Number(req.query.siteId || 0);
  if (!siteId) return res.status(400).json({ error: "Missing siteId" });

  const result = await speedyPost("/location/office/", { siteId });

  if (result.status !== 200) {
    return res.status(result.status).json({
      ok: false,
      status: result.status,
      error: "Speedy error",
      details: result.raw,
    });
  }

  res.json(result.json?.offices || []);
});

// ✅ POST /shipment (Worker-а ти това вика)
app.post("/shipment", async (req, res) => {
  const body = req.body || {};

  // Fix payer enum
  if (body.payment) {
    body.payment.courierServicePayer = normalizeCourierServicePayer(body.payment.courierServicePayer);
  } else {
    body.payment = { courierServicePayer: "SENDER" };
  }

  const result = await speedyPost("/shipment/", body);

  // Speedy sometimes returns 200 but includes error/errors in JSON
  const logicalError = !!(result.json && (result.json.error || result.json.errors));

  if (result.status !== 200 || logicalError) {
    return res.status(result.status || 400).json({
      ok: false,
      status: result.status,
      json: result.json,
      raw: result.raw,
    });
  }

  return res.json(result.json);
});

// ✅ POST /print (Worker-а ти това вика)
app.post("/print", async (req, res) => {
  const body = req.body || {};
  const result = await speedyPost("/print/", body);

  // If Speedy returns PDF bytes, it will still be in raw text (not good)
  // BUT in practice /print on this API returns JSON with link/base64 or similar.
  // If later you see PDF required here, we'll switch to arrayBuffer passthrough.
  const logicalError = !!(result.json && (result.json.error || result.json.errors));

  if (result.status !== 200 || logicalError) {
    return res.status(result.status || 400).json({
      ok: false,
      status: result.status,
      json: result.json,
      raw: result.raw,
    });
  }

  return res.json(result.json);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
