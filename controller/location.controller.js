import { locationCollection } from "../db/db.collection.js";

export const getAllLocations = async (req, res) => {
  try {
    const locations = await locationCollection.find().toArray();
    res.status(200).json(locations);
  } catch (error) {
    res.status(500).json({ message: "Failed to get locations" });
  }
};
