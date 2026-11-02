import express from "express";
import {
  createAttribute,
  deleteAttribute,
  getAllAttribute,
  updateAttribute,
} from "../controller/attribute.controller.js";

const router = express.Router();

router.get("/getAllAttributes", getAllAttribute);
router.post("/createAttribute", createAttribute);
router.patch("/updateAttribute", updateAttribute);
router.delete("/deleteAttribute", deleteAttribute);

export default router;
