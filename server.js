import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const SPEEDY_BASE = "https://api.speedy.bg/v1";

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
  const name = req.query.name  "";

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

  res.json(result.json.sites  []);
});

// GET /offices?siteId=68134
app.get("/offices", async (req, res) => {
  const siteId = Number(req.query.siteId  0);
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

  res.json(result.json.offices  []);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(Server running on port ${PORT}));
