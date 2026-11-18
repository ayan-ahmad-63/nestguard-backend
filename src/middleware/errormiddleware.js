const { sendErrorResponse } = require("../shared/responses/error");

// eslint-disable-next-line no-unused-vars
module.exports = function errorMiddleware(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";
  const errors = err.errors || [];

  if (process.env.NODE_ENV !== "production") {
    console.error(`[ERROR] ${req.method} ${req.url} →`, err.stack || message);
  }

  sendErrorResponse(res, message, errors, status);
};
