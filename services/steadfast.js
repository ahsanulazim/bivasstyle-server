import dotenv from "dotenv";
dotenv.config();

const steadFastApiFetch = async (endpoint, options = {}) => {
  const baseUrl =
    process.env.STEADFAST_BASE_URL || "https://portal.packzy.com/api/v1";
  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Api-Key": process.env.STEADFAST_API_KEY,
      "Secret-Key": process.env.STEADFAST_SECRET_KEY,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.message || `Steadfast API Error: ${res.status} ${res.statusText}`,
    );
  }
  return data;
};

// Create Order in Steadfast (Packzy)
export const createSteadfastOrder = async (orderData) => {
  return steadFastApiFetch("/create_order", {
    method: "POST",
    body: JSON.stringify(orderData),
  });
};

// Check Balance
export const checkSteadfastBalance = async () => {
  return steadFastApiFetch("/get_balance", { method: "GET" });
};

// Track Order by Tracking Code
export const trackSteadfastByCode = async (trackingCode) => {
  return steadFastApiFetch(`/status_by_trackingcode/${trackingCode}`, {
    method: "GET",
  });
};

// Track Order by Invoice
export const trackSteadfastByInvoice = async (invoice) => {
  return steadFastApiFetch(`/status_by_invoice/${invoice}`, {
    method: "GET",
  });
};
