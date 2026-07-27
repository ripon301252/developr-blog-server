// firebaseAdmin.js
const admin = require("firebase-admin");

const serviceAccount = require("./firebase-service-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;


/// middleware/verifyFirebaseToken.js
const admin = require("../firebaseAdmin");

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);

    req.user = decoded; // 🔥 email, uid সব পাবা
    next();
  } catch (error) {
    return res.status(403).send({ message: "Forbidden" });
  }
};

module.exports = verifyFirebaseToken;