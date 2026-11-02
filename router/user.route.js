import express from "express";
import {
  createUser,
  deleteUser,
  getAllUsers,
  getUser,
  updateUser,
} from "../controller/user.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/createUser", createUser);
router.get("/getUser", getUser);
router.delete("/deleteUser", verifyToken, verifyAdmin, deleteUser);
router.put("/updateUser", verifyToken, updateUser);
router.get("/getAllUsers", verifyToken, verifyAdmin, getAllUsers);

export default router;
