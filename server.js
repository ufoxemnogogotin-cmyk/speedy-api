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
  const { type, siteId, officeId, weight, name, phone, orderTotal } = req.body;

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

  const body = {
    sender: {
      privatePerson: false,
      dropoffOfficeId: Number(process.env.SPEEDY_SENDER_OFFICE_ID)
    },

    recipient: {
      privatePerson: true
    },

    service: {
      serviceIds: [type === "office" ? 505 : 503],
      additionalServices: {
        cod: {
          amount: Number(orderTotal || 0)
        }
      }
    },

    content: {
      parcelsCount: 1,
      totalWeight: Number(weight)
    },

    payment: {
      courierServicePayer: "RECIPIENT"
    }
  };

  if (type === "office") {
    body.recipient.pickupOfficeId = Number(officeId);
  } else {
    body.recipient.addressLocation = {
      countryId: 100,
      siteId: Number(siteId)
    };
  }

  const result = await speedyPost("/calculate", body);

  if (result.status !== 200) {
    return res.status(result.status).json({
      error: "Speedy calculate error",
      details: result.json || result.raw,
      sent: body
    });
  }

  const price = result.json?.calculations?.[0]?.price?.total ?? null;

  if (!price) {
    return res.status(500).json({
      error: "No price returned",
      raw: result.json,
      sent: body
    });
  }

  return res.json({ price });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
