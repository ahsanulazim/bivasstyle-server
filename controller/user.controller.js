import admin from "../firebase/firebase.config.js";
import cloudinary from "../lib/cloudinary.js";
import { userCollection } from "../db/db.collection.js";
import { emitRealtimeEvent } from "../lib/socket.js";

export const createUser = async (req, res) => {
  const { name, email, isGoogle, photoURL = "" } = req.body;

  const role = "user";
  const createdAt = new Date();
  const updatedAt = new Date();

  const newUser = {
    name,
    email,
    isGoogle,
    photoURL,
    role,
    createdAt,
    updatedAt,
  };

  // Validate input
  if (!name || !email) {
    return res
      .status(400)
      .json({ success: false, message: "Name and email are required" });
  }

  try {
    await userCollection.insertOne(newUser);
    emitRealtimeEvent("user:updated", { action: "created", email });
    emitRealtimeEvent("dashboard:update", { type: "user", action: "created" });
    res.status(201).json({ success: true, user: newUser });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }
    res.status(500).json({ success: false, message: "Error creating user" });
  }
};

export const getUser = async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  }

  try {
    const user = await userCollection.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching user" });
  }
};

export const deleteUser = async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(userRecord.uid);

    const result = await userCollection.deleteOne({ email });
    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    emitRealtimeEvent("user:updated", { action: "deleted", email });
    emitRealtimeEvent("dashboard:update", { type: "user", action: "deleted" });
    res
      .status(200)
      .json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting user" });
  }
};

export const updateUser = async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required" });
  }

  try {
    const existingUser = await userCollection.findOne({ email });
    if (!existingUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const { _id, role, avatar, removePhoto, ...allowedUpdates } =
      req.body || {};

    // Handle new profile picture upload via Cloudinary
    if (
      avatar &&
      typeof avatar === "string" &&
      avatar.startsWith("data:image")
    ) {
      const uploadRes = await cloudinary.uploader.upload(avatar, {
        folder: "avatars",
        transformation: [
          { width: 400, height: 400, crop: "fill", gravity: "face" },
        ],
      });
      if (uploadRes?.secure_url) {
        allowedUpdates.photoURL = uploadRes.secure_url;
      }
    } else if (removePhoto) {
      allowedUpdates.photoURL = "";
    }

    allowedUpdates.updatedAt = new Date();

    await userCollection.updateOne({ email }, { $set: allowedUpdates });

    const updatedUser = await userCollection.findOne({ email });

    emitRealtimeEvent("user:updated", { action: "updated", email });
    emitRealtimeEvent("dashboard:update", { type: "user", action: "updated" });

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error updating user" });
  }
};

// Get all users
export const getAllUsers = async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = 10;

  const skip = (page - 1) * limit;

  try {
    const users = await userCollection
      .find({ role: "user" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    const totalUsers = await userCollection.countDocuments({ role: "user" });
    const totalPages = Math.ceil(totalUsers / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      users,
      limit,
      totalUsers,
      totalPages,
      hasNextPage,
      hasPrevPage,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch users", error });
  }
};
