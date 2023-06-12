const express = require("express");
const bodyParser = require("body-parser");
const router = require("./routes");
require("dotenv").config();

const app = express();

app.use(express.json());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/api", router);

app.use((req, res, next) => {
  res.status(404).json({ message: "Not Found" });
});

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server running at port: ${PORT}`));
