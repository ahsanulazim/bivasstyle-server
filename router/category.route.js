import express from "express";
import {
  createCategory,
  deleteCategory,
  getAllCategories,
  updateCategory,
} from "../controller/category.controller.js";

const router = express.Router();

router.post("/createCategory", createCategory);
router.put("/updateCategory", updateCategory);
router.get("/getAllCategories", getAllCategories);
router.delete("/deleteCategory", deleteCategory);

export default router;
