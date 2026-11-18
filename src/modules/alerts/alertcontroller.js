const Alert = require("./alertmodel");
const { sendSuccessResponse } = require("../../shared/responses/success");
const { sendErrorResponse } = require("../../shared/responses/error");

// GET /api/v1/alerts?limit=50&unread=true
async function getAlerts(req, res) {
  const { limit = 50, unread } = req.query;
  const filter = {};
  if (unread === "true") filter.acknowledged = false;

  const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(Number(limit)).lean();
  const formatted = alerts.map((a) => ({
    id: a._id.toString(),
    sev: a.severity,
    time: new Date(a.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    title: a.title,
    detail: a.detail,
    gate: a.gate,
    user: a.user,
    acknowledged: a.acknowledged,
  }));

  return sendSuccessResponse(res, "Alerts fetched", formatted, null, 200);
}

// PATCH /api/v1/alerts/:id/acknowledge
async function acknowledgeAlert(req, res) {
  const { id } = req.params;
  const alert = await Alert.findByIdAndUpdate(id, { acknowledged: true }, { new: true });
  if (!alert) {
    return sendErrorResponse(res, "Alert not found", [], 404);
  }
  return sendSuccessResponse(res, "Alert acknowledged", { id: alert._id.toString(), acknowledged: true }, null, 200);
}

// PATCH /api/v1/alerts/acknowledge-all
async function acknowledgeAll(req, res) {
  await Alert.updateMany({ acknowledged: false }, { acknowledged: true });
  return sendSuccessResponse(res, "All alerts acknowledged", null, null, 200);
}

module.exports = { getAlerts, acknowledgeAlert, acknowledgeAll };
