const { z } = require("zod");

const loginSchema = z.object({
  email: z.string().email({ message: "Valid email required" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }),
});

module.exports = { loginSchema };
