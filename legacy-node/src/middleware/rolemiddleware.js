const { sendErrorResponse } = require("../shared/responses/error");

/**
 * requireRole("admin", "warden") → middleware that only allows those roles through.
 * Must come after authMiddleware.
 */
function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return sendErrorResponse(res, "Authentication required", [], 401);
    }
    if (!allowedRoles.includes(req.user.role)) {
      return sendErrorResponse(
        res,
        `Access denied — requires one of: ${allowedRoles.join(", ")}`,
        [],
        403
      );
    }
    next();
  };
}

module.exports = { requireRole };
