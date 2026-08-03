require("express-async-errors");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");

const healthRoutes = require("./routes/health/healthroutes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(compression());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1/health-check", healthRoutes);

module.exports = app;