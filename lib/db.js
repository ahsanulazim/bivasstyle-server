import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.warn("MONGODB_URI is not defined in environment variables");
}

const client = new MongoClient(uri || "");

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("MongoDB connection error:", err);
    throw err;
  }
}

// Call this only when your application terminates
export async function disconnectFromMongoDB() {
  try {
    await client.close();
    console.log("MongoDB disconnected successfully");
  } catch (err) {
    console.error("Error disconnecting from MongoDB:", err);
  }
}

export { client };
export default client;
