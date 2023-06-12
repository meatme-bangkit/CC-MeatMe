const { Storage } = require("@google-cloud/storage");
require("dotenv").config();

const storage = new Storage({
  projectId: process.env.PROJECT_ID,
  keyFilename: process.env.KEYFILE,
});

const bucket = storage.bucket(process.env.BUCKET_NAME);

bucket
  .getFiles()
  .then(() => {
    console.log("Google Cloud Storage connection successful");
  })
  .catch((err) => {
    console.error("Google Cloud Storage connection error:", err);
  });

module.exports = storage;
