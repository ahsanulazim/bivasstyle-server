import express from "express";
import {
  createProduct,
  deleteProduct,
  getAllProducts,
  getCategoryFilters,
  getNewArriavals,
  getProductBySlug,
  getProductsByFilters,
  searchProducts,
  updateProduct,
} from "../controller/product.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/createProduct", verifyToken, verifyAdmin, createProduct);
router.put("/updateProduct", verifyToken, verifyAdmin, updateProduct);
router.get("/getAllProducts", getAllProducts);
router.get("/getProductBySlug", getProductBySlug);
router.get("/getProductsByFilters", getProductsByFilters);
router.get("/getNewArrivals", getNewArriavals);
router.get("/getCategoryFilters", getCategoryFilters);
router.get("/getCategoryFIlters", getCategoryFilters);
router.get("/search", searchProducts);
router.delete("/deleteProduct", verifyToken, verifyAdmin, deleteProduct);

export default router;
