const express = require("express");
const router = express.Router();
const db = require("./config/db");
const gcs = require("./config/storage");
const bcrypt = require("bcrypt");
const JWT = require("jsonwebtoken");
const Joi = require("joi");
const { Storage } = require("@google-cloud/storage");
const multer = require("multer");

// validation input

const schemaRegister = Joi.object({
  name: Joi.string().min(3).max(30).required().messages({
    "any.required": "Name is required",
    "string.min": "Name allowed min 3 letters.",
    "string.max": "Name allowed max 30 letters.",
  }),
  email: Joi.string().email().required().messages({
    "any.required": "Email is required",
    "string.email": "Email must be a valid email address",
  }),
  password: Joi.string().min(10).required().messages({
    "any.required": "Password is required",
    "string.min": "Password must be at least 10 characters long",
  }),
  phone_number: Joi.string().required().messages({
    "any.required": "Phone number is required",
  }),
  address: Joi.string().required().messages({
    "any.required": "Address is required",
  }),
});

const schemaLogin = Joi.object({
  email: Joi.string().email().required().messages({
    "any.required": "Email is required",
    "string.email": "Email must be a valid email address",
  }),
  password: Joi.string().required().messages({
    "any.required": "Password is required",
  }),
});

const validateSignup = (req, res, next) => {
  const validationResult = schemaRegister.validate(req.body);
  if (validationResult.error) {
    return res
      .status(400)
      .json({ error: validationResult.error.details[0].message });
  }
  next();
};

const validateLogin = (req, res, next) => {
  const validationResult = schemaLogin.validate(req.body);
  if (validationResult.error) {
    return res
      .status(400)
      .json({ error: validationResult.error.details[0].message });
  }
  next();
};

// buyer

// signup

router.post("/signup", validateSignup, (req, res, next) => {
  // checking account first, existed or not with email
  const sql = "SELECT * FROM buyers WHERE email = ?";
  const { name, email, password, phone_number, address } = req.body;
  db.query(sql, [email], (err, result) => {
    if (result.length) {
      return res.status(409).send({
        message: "This account existed",
      });
    } else {
      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          return res.status(500).send({
            message: err,
          });
        } else {
          const sql =
            "INSERT INTO buyers (name, email, password, phone_number, address) VALUES (?, ?, ?, ?, ?)";
          db.query(
            sql,
            [name, email, hash, phone_number, address],
            (err, result) => {
              if (err) {
                return res.status(400).send({
                  message: err,
                });
              }
              return res.status(201).send({
                message: "Account Successfully Registered!",
              });
            }
          );
        }
      });
    }
  });
});

// sigin
router.post("/signin", validateLogin, (req, res, next) => {
  const { email, password } = req.body;
  const sql = "SELECT * FROM buyers WHERE email = ?";
  db.query(sql, [email], (err, result) => {
    if (err) {
      return res.status(400).send({
        message: err,
      });
    }
    if (!result.length) {
      return res.status(401).send({
        message: "Wrong email or password",
      });
    }
    bcrypt.compare(password, result[0]["password"], (err, isMatch) => {
      if (err) {
        return res.status(401).send({
          message: "Wrong email or password",
        });
      }
      if (isMatch && result[0].id) {
        const token = JWT.sign({ id: result[0].id }, process.env.JWT_SECRET, {
          expiresIn: "1h",
        });
        return res.status(200).send({
          message: "Login Success!",
          email: result[0].email,
          token: token,
        });
      } else {
        return res.status(401).send({
          message: "Wrong email or password",
        });
      }
    });
  });
});

// home app (beranda)
router.get("/products", (req, res) => {
  const email = req.params.email;
  const sqlQuery = "SELECT * FROM products";

  db.query(sqlQuery, (err, result) => {
    if (err) throw err;
    return res.send({ data: result, message: "all products displayed!" });
  });
});

// profile app buyer
router.get("/profile/:email", (req, res) => {
  const email = req.params.email;
  const sql = "SELECT * FROM buyers WHERE email = ?";

  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }
  const token = req.headers.authorization.split(" ")[1];
  const decoded = JWT.verify(token, process.env.JWT_SECRET);
  db.query(sql, [email, decoded.id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        message: "Internal server error",
      });
    }
    return res.status(200).json({
      message: "Success",
      data: result,
    });
  });
});

// search products
router.get("/products/search/:meatname", (req, res) => {
  const meatname = req.params.meatname;
  const sql = "SELECT * FROM products WHERE meatname = ?";
  db.query(sql, [meatname], (err, result) => {
    if (err) throw err;
    return res.send(result);
  });
});

// products details
router.get("/products/:meatname", (req, res) => {
  const meatname = req.params.meatname;
  const sql = `SELECT * FROM products WHERE meatname = ?`;
  db.query(sql, [meatname], (err, result) => {
    if (err) throw err;
    return res.send(result);
  });
});

// cart or order product
router.post("/order", (req, res) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }
  const { productId, quantity } = req.body;

  // get stock and price
  const sql = `SELECT price, stock FROM products WHERE id = ?`;
  db.query(sql, [productId], (err, results) => {
    if (err) {
      throw err;
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    const product = results[0];
    const { price, stock } = product;

    if (stock < quantity) {
      return res.status(400).json({ error: "Insufficient stock" });
    }

    const totalPrice = price * quantity;

    const insertOrder = `INSERT INTO orders (product_id, quantity, total_price) VALUES (?, ?, ?)`;
    db.query(insertOrder, [productId, quantity, totalPrice], (err, results) => {
      if (err) {
        throw err;
      }

      // update stock when buyers make a cart or oder product
      const updatedStock = stock - quantity;
      const updateStock = `UPDATE products SET stock = ? WHERE id = ?`;
      db.query(updateStock, [updatedStock, productId], (err, results) => {
        if (err) {
          throw err;
        }

        res.status(201).json({ message: "Order created successfully" });
      });
    });
  });
});

// buyers update status info for order
router.put("/order/:orderId", (req, res) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }
  const { orderId } = req.params;
  const { status } = req.body;

  // delete order if status is delivered
  if (status === "delivered") {
    const deleteOrder = `DELETE FROM orders WHERE id = ?`;
    db.query(deleteOrder, [orderId], (err, results) => {
      if (err) {
        throw err;
      }

      res.status(200).json({ message: "Order deleted successfully" });
    });
  } else {
    // update the status of the order in the order table
    const updateOrder = `UPDATE orders SET status = ? WHERE id = ?`;
    db.query(updateOrder, [status, orderId], (err, results) => {
      if (err) {
        throw err;
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      res.status(200).json({ message: "Order status updated successfully" });
    });
  }
});

// buyers view order status info
router.get("/order/:orderId", (req, res) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }
  const { orderId } = req.params;

  const sql = `SELECT * FROM orders WHERE id = ?`;
  db.query(sql, [orderId], (err, results) => {
    if (err) {
      throw err;
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.status(200).json(results[0]);
  });
});

// seller

// register
router.post("/register", validateSignup, (req, res, next) => {
  // checking account first, existed or not with email
  const sql = "SELECT * FROM sellers WHERE email = ?";
  const { name, email, password, phone_number, address } = req.body;
  db.query(sql, [email], (err, result) => {
    if (result.length) {
      return res.status(409).send({
        message: "This account existed",
      });
    } else {
      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          return res.status(500).send({
            message: err,
          });
        } else {
          const sql =
            "INSERT INTO sellers (name, email, password, phone_number, address) VALUES (?, ?, ?, ?, ?)";
          db.query(
            sql,
            [name, email, hash, phone_number, address],
            (err, result) => {
              if (err) {
                return res.status(400).send({
                  message: err,
                });
              }
              return res.status(201).send({
                message: "Account Successfully Registered!",
              });
            }
          );
        }
      });
    }
  });
});

// login
router.post("/login", validateLogin, (req, res, next) => {
  const { email, password } = req.body;
  const sql = "SELECT * FROM sellers WHERE email = ?";
  db.query(sql, [email], (err, result) => {
    if (err) {
      return res.status(400).send({
        message: err,
      });
    }
    if (!result.length) {
      return res.status(401).send({
        message: "Wrong email or password",
      });
    }
    bcrypt.compare(password, result[0]["password"], (err, isMatch) => {
      if (err) {
        return res.status(401).send({
          message: "Wrong email or password",
        });
      }
      if (isMatch && result[0].id) {
        const token = JWT.sign({ id: result[0].id }, process.env.JWT_SECRET, {
          expiresIn: "1h",
        });
        return res.status(200).send({
          message: "Login Success!",
          email: result[0].email,
          token: token,
        });
      } else {
        return res.status(401).send({
          message: "Wrong email or password",
        });
      }
    });
  });
});

// profile app seller
router.get("/profileSeller/:email", (req, res) => {
  const email = req.params.email;
  const sql = "SELECT * FROM sellers WHERE email = ?";

  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }
  const token = req.headers.authorization.split(" ")[1];
  const decoded = JWT.verify(token, process.env.JWT_SECRET);
  db.query(sql, [email, decoded.id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        message: "Internal server error",
      });
    }
    return res.status(200).json({
      message: "Success",
      data: result,
    });
  });
});

// make data products (only works for seller)

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ["jpg", "jpeg", "png"];
  const extension = file.originalname.split(".").pop().toLowerCase();
  if (allowedExtensions.includes(extension)) {
    cb(null, true);
  } else {
    cb(null, false);
  }
};

const upload = multer({ storage, fileFilter });

router.post("/products", upload.single("image"), async (req, res) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }

  const token = req.headers.authorization.split(" ")[1];

  try {
    const decoded = JWT.verify(token, process.env.JWT_SECRET);
    const userID = decoded.id;

    // product details
    const { address, meatname, details, stock, price, seller } = req.body;
    const image = req.file;

    if (!image) {
      return res.status(400).send({
        message: "No image file uploaded or your files is not images",
      });
    }

    const date = new Date();

    const fileName = `${date.getTime()}_${image.originalname}`;

    // upload the image to GCS
    const blob = gcs.bucket(process.env.BUCKET_NAME).file(fileName);
    const stream = blob.createWriteStream({
      metadata: {
        contentType: image.mimetype,
      },
    });

    stream.on("error", (err) => {
      console.error(err);
      res.status(500).send("Error uploading image");
    });

    stream.on("finish", async () => {
      try {
        const imageUrl = `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${fileName}`;
        const sql = `
          INSERT INTO products(address, meatname, details, stock, price, seller, image)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
          address,
          meatname,
          details,
          stock,
          price,
          seller,
          imageUrl,
        ];

        await db.execute(sql, values);

        res.status(201).send("Product created successfully");
      } catch (err) {
        console.error(err);
        res.status(500).send("Error creating product");
      }
    });

    stream.end(image.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error verifying token");
  }
});

// change data product by ID
router.put("/products/:id_product", (req, res) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }

  const token = req.headers.authorization.split(" ")[1];
  const decoded = JWT.verify(token, process.env.JWT_SECRET);

  const id_product = req.params.id_product;
  const address = req.body.address;
  const meatname = req.body.meatname;
  const details = req.body.details;
  const stock = req.body.stock;
  const price = req.body.price;

  const sql =
    "UPDATE products SET address = ?, meatname = ?, details = ?, stock = ?, price = ? WHERE id = ?";

  db.query(
    sql,
    [address, meatname, details, stock, price, id_product, decoded.id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error updating product");
      }
      return res.send({ data: "Product updated successfully" });
    }
  );
});

// delete product data by ID
router.delete("/products/:id_product", (req, res) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }

  const token = req.headers.authorization.split(" ")[1];
  const decoded = JWT.verify(token, process.env.JWT_SECRET);

  const id_product = req.params.id_product;
  const sql = "DELETE FROM products WHERE id = ?";

  db.query(sql, [id_product, decoded.id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error deleting product");
    }
    return res.send({ message: "Product deleted!" });
  });
});

// sellers get order info from buyers
router.get("/orders", (req, res) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith("Bearer")
  ) {
    return res.status(422).json({
      message: "Unauthorized! Please input the token you obtained before!",
    });
  }
  const sql = `SELECT * FROM orders`;
  db.query(sql, (err, results) => {
    if (err) {
      throw err;
    }

    res.status(200).json(results);
  });
});

module.exports = router;
