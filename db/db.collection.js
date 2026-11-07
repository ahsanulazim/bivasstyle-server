import client from "../lib/db.js";

const DB_NAME = process.env.DB_NAME || "bivasstyle";
const db = client.db(DB_NAME);

export const orderCollection = db.collection("orders");
export const userCollection = db.collection("users");
export const locationCollection = db.collection("locations");
export const productCollection = db.collection("products");
export const categoryCollection = db.collection("categories");
export const couponCollection = db.collection("coupons");
export const reviewCollection = db.collection("reviews");
export const attributeCollection = db.collection("attributes");
export const variationCollection = db.collection("variations");
export const shippingRateCollection = db.collection("shipping_rates");
export const shippingSettingsCollection = db.collection("shipping_settings");

export const initIndexes = async () => {
  try {
    await Promise.all([
      productCollection.createIndex({ slug: 1 }, { unique: true }),
      categoryCollection.createIndex({ slug: 1 }, { unique: true }),
      couponCollection.createIndex({ code: 1 }, { unique: true }),
      attributeCollection.createIndex({ slug: 1 }, { unique: true }),
      variationCollection.createIndex({ slug: 1 }, { unique: true }),
      userCollection.createIndex({ email: 1 }, { unique: true }),
    ]);
    console.log("Database indexes initialized successfully");
  } catch (error) {
    console.error("Error creating database indexes:", error.message);
  }
};
