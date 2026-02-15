import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const SPEEDY_BASE = "https://api.speedy.bg/v1";

function pickEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function normalizeShipmentRole(v, fallback = "SENDER") {
  if (!v) return fallback;
  const s = String(v).toUpperCase().trim();

  // Speedy accepts only these (per docs / your error)
  if (s === "SENDER" || s === "RECIPIENT" || s === "THIRD_PARTY") return s;

  // Your old value coming from worker/proxy
  if (s === "CONTRACT_CLIENT") return "SENDER";

  // anything else -> safe fallback
  return fallback;
}

function normalizeCreateShipmentBody(body) {
  const b = body && typeof body === "object" ? { ...body } : {};

  // Fix payer enum(s)
  if (b.payment && typeof b.payment === "object") {
    b.payment = { ...b.payment };
    b.payment.courierServicePayer = normalizeShipmentRole(
      b.payment.courierServicePayer,
      "SENDER"
    );
    if (b.payment.declaredValuePayer) {
      b.payment.declaredValuePayer = normalizeShipmentRole(
        b.payment.declaredValuePayer,
        "SENDER"
      );
    }
  }

  // Options before payment has returnShipmentPayer (same enum family)
  if (b.optionsBeforePayment && typeof b.optionsBeforePayment === "object") {
    b.optionsBeforePayment = { ...b.optionsBeforePayment };
    if (b.optionsBeforePayment.returnShipmentPayer) {
      b.optionsBeforePayment.returnShipmentPayer = normalizeShipmentRole(
        b.optionsBeforePayment.returnShipmentPayer,
        "SENDER"
      );
    }
  }

  return b;
}

async function speedyPost(path, body) {
  const userName = pickEnv("SPEEDY_USERNAME");
  const password = pickEnv("SPEEDY_PASSWORD");

  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userName,
      password,
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

  return { status: res.status, json, raw: text };
}

// --- Health / sanity ---
app.get("/", (req, res) => res.send("OK LIVE"));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "speedy-api-proxy" });
});

// --- Locations (checkout helpers) ---
// GET /sites?name=София
app.get("/sites", async (req, res) => {
  const name = String(req.query.name || "");

  const result = await speedyPost("/location/site/", {
    countryId: 100,
    name,
  });

  if (result.status !== 200) {
    return res.status(result.status).json({
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
      error: "Speedy error",
      details: result.raw,
    });
  }

  res.json(result.json?.offices || []);
});

// --- Shipment (dashboard "Create waybill") ---
// POST /shipment
// Body пример (минимално): { sender, recipient, service, content, payment, ref1 }
app.post("/shipment", async (req, res) => {
  try {
    const incoming = req.body || {};
    const normalized = normalizeCreateShipmentBody(incoming);

    // IMPORTANT:
    // Speedy docs call is POST to /shipment/ (in their API examples)
    const result = await speedyPost("/shipment/", normalized);

    if (result.status !== 200) {
      return res.status(result.status).json({
        ok: false,
        error: "Speedy createShipment failed",
        details: result.raw,
      });
    }

    // Return the whole Speedy response so the worker can read AWB / parcels etc.
    return res.json({ ok: true, data: result.json });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Proxy error",
      details: String(e?.message || e),
    });
  }
});

// Make GET /shipment not look "broken" in browser
app.get("/shipment", (req, res) => {
  res.status(405).json({
    ok: false,
    message: "Use POST /shipment (this endpoint creates waybills).",
    hint: "Browser GET will not create shipments.",
  });
});

// --- Contract clients (optional helper) ---
// GET /contract-clients
app.get("/contract-clients", async (req, res) => {
  const result = await speedyPost("/client/contract/", {});

  if (result.status !== 200) {
    return res.status(result.status).json({
      error: "Speedy error",
      details: result.raw,
    });
  }

  // Depending on API shape it may be "clients" / "contractClients" etc.
  res.json(result.json);
});

// --- Basic error handler ---
app.use((err, req, res, next) => {
  res.status(500).json({ ok: false, error: "Server error", details: String(err) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
