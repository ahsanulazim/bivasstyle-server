import admin from "../firebase/firebase.config.js";
import { userCollection } from "../db/db.collection.js";

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized. Token missing." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Token verification error:", error.message);
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token" });
  }
};

export const verifyAdmin = async (req, res, next) => {
  if (!req.user || !req.user.email) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const user = await userCollection.findOne({ email: req.user.email });
    if (!user || user.role !== "admin") {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden. Admin access required." });
    }
    req.adminUser = user;
    next();
  } catch (error) {
    console.error("Admin verification error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

