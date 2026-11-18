const Gate = require("./gatemodel");
const { sendSuccessResponse } = require("../../shared/responses/success");

let cachedGates = null;
let cacheExpiry = 0;

// GET /api/v1/gates
async function getGates(req, res) {
  const now = Date.now();
  if (cachedGates && now < cacheExpiry) {
    return sendSuccessResponse(res, "Gates fetched", cachedGates, null, 200);
  }

  const gates = await Gate.find({}).sort({ name: 1 }).lean();
  const formatted = gates.map((g) => ({
    id: g._id.toString(),
    name: g.name,
    location: g.location || "",
    status: g.status,
  }));

  cachedGates = formatted;
  cacheExpiry = now + 60000; // 60s TTL
  return sendSuccessResponse(res, "Gates fetched", formatted, null, 200);
}

module.exports = { getGates };
