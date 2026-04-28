import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const SPEEDY_BASE = "https://api.speedy.bg/v1";

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function speedyPost(path, body) {
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

  return { status: res.status, json, raw: text };
}

// GET /sites?name=София
app.get("/sites", async (req, res) => {
 const name = req.query.name || "";

  const result = await speedyPost("/location/site/", {
    countryId: 100,
    name,
  });

 if (result.status !== 200) {
  console.log("❌ SPEEDY ERROR RAW:", result.raw);
  console.log("❌ SPEEDY ERROR JSON:", result.json);

  return res.status(500).json({
    error: "Speedy calculate error",
    details: result.json || result.raw,
  });
}
res.json(result.json?.sites || []);
});

// GET /offices?siteId=68134
app.get("/offices", async (req, res) => {
  const siteId = Number(req.query.siteId || 0);
  if (!siteId) {
    return res.status(400).json({ error: "Missing siteId" });
  }

  const result = await speedyPost("/location/office/", {
    siteId,
  });

  if (result.status !== 200) {
    return res.status(result.status).json({
      error: "Speedy error",
      details: result.raw,
    });
  }

  res.json(result.json?.offices || []);
});

// POST /calculate
app.post("/calculate", async (req, res) => {
  const { type, siteId, officeId, weight, orderTotal } = req.body;

  if (!type) {
    return res.status(400).json({ error: "Missing type" });
  }

  if (!weight) {
    return res.status(400).json({ error: "Missing weight" });
  }

  if (!siteId) {
    return res.status(400).json({ error: "Missing siteId" });
  }

  if (type === "office" && !officeId) {
    return res.status(400).json({ error: "Missing officeId" });
  }

  const total = Number(orderTotal || 0);

  // 🚚 FREE SHIPPING над/равно 100 евро
  if (total >= 100) {
    return res.json({
      price: 0,
      label: "Безплатна",
      fake: true
    });
  }

  // 🧪 ФИКТИВНИ ЦЕНИ — тук си ги настройваш както искаш
  let price = 0;

  if (type === "office") {
    price = 5.99; // Спиди до офис
  } else if (type === "address") {
    price = 7.99; // Спиди до адрес
  } else {
    price = 6.99;
  }

  return res.json({
    price,
    label: price.toFixed(2) + " лв",
    fake: true
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
