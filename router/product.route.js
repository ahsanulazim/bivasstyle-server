import express from "express";
import {
  bulkUpdateProducts,
  createProduct,
  deleteProduct,
  getAllProducts,
  getCategoryFilters,
  getNewArriavals,
  getProductBySlug,
  getProductsByFilters,
  quickUpdateProductStock,
  searchProducts,
  toggleProductFeatured,
  updateProduct,
  uploadProductImages,
} from "../controller/product.controller.js";
import { verifyAdmin, verifyToken } from "../middleware/auth.middleware.js";
import { uploadImagesMiddleware } from "../middleware/upload.middleware.js";

const router = express.Router();

router.post(
  "/uploadImages",
  verifyToken,
  verifyAdmin,
  uploadImagesMiddleware.array("images", 10),
  uploadProductImages,
);
router.post("/createProduct", verifyToken, verifyAdmin, createProduct);
router.put("/updateProduct", verifyToken, verifyAdmin, updateProduct);
router.patch("/toggleFeatured", verifyToken, verifyAdmin, toggleProductFeatured);
router.patch("/quickStock", verifyToken, verifyAdmin, quickUpdateProductStock);
router.post("/bulkUpdate", verifyToken, verifyAdmin, bulkUpdateProducts);
router.get("/getAllProducts", getAllProducts);
router.get("/getProductBySlug", getProductBySlug);
router.get("/getProductsByFilters", getProductsByFilters);
router.get("/getNewArrivals", getNewArriavals);
router.get("/getCategoryFilters", getCategoryFilters);
router.get("/getCategoryFIlters", getCategoryFilters);
router.get("/search", searchProducts);
router.delete("/deleteProduct", verifyToken, verifyAdmin, deleteProduct);

export default router;
