const jwt = require("jsonwebtoken");
const { sendErrorResponse } = require("../shared/responses/error");

/**
 * Verifies JWT from:
 *   1. Authorization: Bearer <token>  header
 *   2. ng_token httpOnly cookie
 *
 * On success attaches req.user = { id, email, role, name }
 */
module.exports = function authMiddleware(req, res, next) {
  try {
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    } else if (req.cookies && req.cookies.ng_token) {
      token = req.cookies.ng_token;
    }

    if (!token) {
      return sendErrorResponse(res, "Authentication required", [], 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, name: decoded.name };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return sendErrorResponse(res, "Session expired — please log in again", [], 401);
    }
    return sendErrorResponse(res, "Invalid token", [], 401);
  }
};
