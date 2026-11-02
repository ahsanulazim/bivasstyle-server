import { ObjectId } from "mongodb";
import cloudinary from "../lib/cloudinary.js";
import { shippingRateCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createShippingRate = async (req, res) => {
  let {
    baseCharge,
    companyLogo,
    companyName,
    extraCharge,
    location,
    status,
    weightLimit,
  } = req.body;

  if (
    !baseCharge ||
    !companyLogo ||
    !companyName ||
    !location ||
    !status ||
    !weightLimit
  ) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (baseCharge <= 0 || extraCharge <= 0 || weightLimit <= 0) {
    return res.status(400).json({
      message:
        "Base charge, extra charge and weight limit must be greater than 0",
    });
  }

  if (location.length === 0) {
    return res.status(400).json({ message: "Location is required" });
  }

  if (!extraCharge) {
    extraCharge = 0;
  }

  let companyLogoUrl;

  if (companyLogo) {
    const uploadRes = await cloudinary.uploader.upload(companyLogo, {
      folder: "shipping",
    });
    companyLogoUrl = uploadRes?.secure_url || "";
  }

  const createdAt = new Date();
  const updatedAt = new Date();

  const shippingRate = {
    baseCharge,
    companyLogo: companyLogoUrl,
    companyName,
    extraCharge,
    location,
    status: status === "true" ? true : false,
    weightLimit,
    createdAt,
    updatedAt,
  };

  try {
    await shippingRateCollection.insertOne(shippingRate);
    emitRealtimeEvent("shipping:updated", { action: "created" });
    emitRealtimeEvent("dashboard:update", { type: "shipping", action: "created" });
    res
      .status(201)
      .json({ success: true, message: "Shipping rate created successfully" });
  } catch (error) {
    console.error("Error creating shipping rate:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getAllShippingRates = async (req, res) => {
  try {
    const shippingRates = await shippingRateCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json(shippingRates);
  } catch (error) {
    console.error("Error fetching shipping rates:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const getShippingRateByDistrict = async (req, res) => {
  const { district } = req.query;

  if (!district) {
    return res.status(400).json({ success: false, message: "District is required" });
  }

  try {
    const insideDhaka = await shippingRateCollection.findOne({
      "location.value": district,
    });

    if (insideDhaka) {
      res.status(200).json(insideDhaka);
    } else {
      const outsideDhaka = await shippingRateCollection.findOne({
        "location.value": "all",
      });
      res.status(200).json(outsideDhaka);
    }
  } catch (error) {
    console.error("Error fetching shipping rate:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

export const deleteShippingRate = async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Shipping rate ID is required" });
  }

  try {
    const shippingRate = await shippingRateCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!shippingRate) {
      return res
        .status(404)
        .json({ success: false, message: "Shipping rate not found" });
    }
    if (shippingRate.companyLogo) {
      const deleteImage = shippingRate.companyLogo.split("/").pop().split(".");
      try {
        await cloudinary.uploader.destroy(`shipping/${deleteImage}`);
        console.log("Deleted Image from Cloudinary");
      } catch (error) {
        console.error("Error Deleting Image", error);
      }
    }
    await shippingRateCollection.deleteOne({ _id: new ObjectId(id) });
    emitRealtimeEvent("shipping:updated", { action: "deleted", shippingRateId: id });
    emitRealtimeEvent("dashboard:update", { type: "shipping", action: "deleted" });
    res
      .status(200)
      .json({ success: true, message: "Shipping rate deleted successfully" });
  } catch (error) {
    console.error("Error deleting shipping rate:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete shipping rate" });
  }
};
