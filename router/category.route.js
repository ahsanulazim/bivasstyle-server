import express from "express";
import {
  createCategory,
  deleteCategory,
  getAllCategories,
  toggleCategoryFeatured,
  updateCategory,
} from "../controller/category.controller.js";

const router = express.Router();

router.post("/createCategory", createCategory);
router.put("/updateCategory", updateCategory);
router.patch("/toggleFeatured", toggleCategoryFeatured);
router.get("/getAllCategories", getAllCategories);
router.delete("/deleteCategory", deleteCategory);

export default router;
