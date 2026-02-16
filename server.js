import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const SPEEDY_BASE = "https://api.speedy.bg/v1";

// --- helpers ---
function pickAuth(payload = {}) {
  // Allow passing credentials from the Shopify app settings (recommended)
  // If missing, fallback to environment variables (single-tenant mode)
  const userName = payload.userName || process.env.SPEEDY_USERNAME;
  const password = payload.password || process.env.SPEEDY_PASSWORD;

  if (!userName || !password) {
    return { userName: null, password: null, error: "Missing Speedy credentials" };
  }

  return { userName, password, error: null };
}

function normalizeCourierServicePayer(payment) {
  if (!payment) return payment;

  // Legacy value seen in your error:
  // CONTRACT_CLIENT is NOT accepted by Speedy. Only:
  // RECIPIENT, SENDER, THIRD_PARTY
  const allowed = new Set(["RECIPIENT", "SENDER", "THIRD_PARTY"]);

  const out = { ...payment };

  if (out.courierServicePayer === "CONTRACT_CLIENT") {
    // safest default: sender pays (most common for merchants)
    out.courierServicePayer = "SENDER";
  }

  if (out.declaredValuePayer === "CONTRACT_CLIENT") {
    out.declaredValuePayer = "SENDER";
  }

  // If someone passes lowercase etc.
  if (typeof out.courierServicePayer === "string") {
    out.courierServicePayer = out.courierServicePayer.toUpperCase();
  }
  if (typeof out.declaredValuePayer === "string") {
    out.declaredValuePayer = out.declaredValuePayer.toUpperCase();
  }

  // If invalid after normalization, default to SENDER (avoid hard failure)
  if (out.courierServicePayer && !allowed.has(out.courierServicePayer)) {
    out.courierServicePayer = "SENDER";
  }
  if (out.declaredValuePayer && !allowed.has(out.declaredValuePayer)) {
    out.declaredValuePayer = "SENDER";
  }

  return out;
}

async function speedyPost(path, body, auth) {
  const res = await fetch(SPEEDY_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userName: auth.userName,
      password: auth.password,
      language: body.language || "BG",
      ...body,
      // IMPORTANT: ensure auth isn't overridden by the rest of body accidentally
      userName: auth.userName,
      password: auth.password,
    }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: res.status, json, raw: text };
}

function isSpeedyLogicalError(result) {
  // Some APIs return 200 with an "error" object
  return (
    result?.json &&
    (result.json.error ||
      result.json.errors ||
      result.json?.context ||
      result.json?.message)
  );
}

// --- health ---
app.get("/", (req, res) => res.status(200).send("OK LIVE"));

// --- checkout helpers ---
// GET /sites?name=София
app.get("/sites", async (req, res) => {
  const name = String(req.query.name || "");
  const { userName, password, error } = pickAuth({
    userName: req.query.userName,
    password: req.query.password,
  });
  if (error) return res.status(400).json({ error });

  const result = await speedyPost(
    "/location/site/",
    { countryId: 100, name },
    { userName, password }
  );

  if (result.status !== 200 || isSpeedyLogicalError(result)) {
    return res.status(502).json({
      error: "Speedy error (sites)",
      status: result.status,
      details: result.json || result.raw,
    });
  }

  res.json(result.json?.sites || []);
});

// GET /offices?siteId=68134
app.get("/offices", async (req, res) => {
  const siteId = Number(req.query.siteId || 0);
  if (!siteId) return res.status(400).json({ error: "Missing siteId" });

  const { userName, password, error } = pickAuth({
    userName: req.query.userName,
    password: req.query.password,
  });
  if (error) return res.status(400).json({ error });

  const result = await speedyPost(
    "/location/office/",
    { siteId },
    { userName, password }
  );

  if (result.status !== 200 || isSpeedyLogicalError(result)) {
    return res.status(502).json({
      error: "Speedy error (offices)",
      status: result.status,
      details: result.json || result.raw,
    });
  }

  res.json(result.json?.offices || []);
});

// --- contract clients (super useful for correct clientId/objectId) ---
// GET /contract/clients
app.get("/contract/clients", async (req, res) => {
  const { userName, password, error } = pickAuth({
    userName: req.query.userName,
    password: req.query.password,
  });
  if (error) return res.status(400).json({ error });

  const result = await speedyPost(
    "/client/contract/",
    {},
    { userName, password }
  );

  if (result.status !== 200 || isSpeedyLogicalError(result)) {
    return res.status(502).json({
      error: "Speedy error (contract clients)",
      status: result.status,
      details: result.json || result.raw,
    });
  }

  res.json(result.json);
});

// --- create shipment ---
// POST /shipment
// Body should be the CreateShipmentRequest WITHOUT userName/password (but we allow them too).
// We will:
// - inject date if missing
// - normalize payment enum values
app.post("/shipment", async (req, res) => {
  const payload = req.body || {};

  const { userName, password, error } = pickAuth(payload);
  if (error) return res.status(400).json({ error });

  // Copy payload but remove auth keys so they don't fight our injected auth
  const body = { ...payload };
  delete body.userName;
  delete body.password;

  // Default date to today if missing
  if (!body.date) {
    body.date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }

  // Normalize payer enums
  if (body.payment) {
    body.payment = normalizeCourierServicePayer(body.payment);
  }

  const result = await speedyPost("/shipment/", body, { userName, password });

  if (result.status !== 200 || isSpeedyLogicalError(result)) {
    return res.status(502).json({
      error: "Speedy error (create shipment)",
      status: result.status,
      details: result.json || result.raw,
    });
  }

  // Return the Speedy response as-is
  res.json(result.json);
});

// Optional alias if your worker calls /createShipment or /waybill in the proxy
app.post("/createShipment", async (req, res) => {
  // forward to /shipment handler
  req.url = "/shipment";
  return app._router.handle(req, res);
});

app.post("/waybill", async (req, res) => {
  req.url = "/shipment";
  return app._router.handle(req, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
