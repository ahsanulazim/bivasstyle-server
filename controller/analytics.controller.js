import { ObjectId } from "mongodb";
import { sendFacebookCapiEvent } from "../services/facebookCapi.js";
import {
  orderCollection,
  productCollection,
  userCollection,
  couponCollection,
} from "../db/db.collection.js";

/**
 * Helper to get date threshold based on query parameter
 */
const getDateRangeFilter = (range = "30d", customStart, customEnd) => {
  const now = new Date();
  let startDate = new Date();

  if (customStart && customEnd) {
    return {
      createdAt: {
        $gte: new Date(customStart),
        $lte: new Date(customEnd),
      },
    };
  }

  switch (range) {
    case "7d":
      startDate.setDate(now.getDate() - 7);
      break;
    case "30d":
      startDate.setDate(now.getDate() - 30);
      break;
    case "90d":
      startDate.setDate(now.getDate() - 90);
      break;
    case "month":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "year":
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case "all":
    default:
      return {};
  }

  return {
    createdAt: { $gte: startDate },
  };
};

export const getAnalyticsSummary = async (req, res) => {
  try {
    const { range = "30d", startDate, endDate } = req.query;
    const dateFilter = getDateRangeFilter(range, startDate, endDate);

    // Fetch all orders matching the date range
    const orders = await orderCollection
      .find(dateFilter)
      .sort({ createdAt: -1 })
      .toArray();

    // All-time or general counts for broader context
    const totalProductsCount = await productCollection.countDocuments();
    const totalUsersCount = await userCollection.countDocuments();

    // 1. Order Status Counts & KPI Calculations
    const validOrders = orders.filter((o) => o.status !== "cancelled");
    const cancelledOrders = orders.filter((o) => o.status === "cancelled");
    const deliveredOrders = orders.filter((o) => o.status === "delivered");
    const shippedOrders = orders.filter((o) => o.status === "shipped");
    const processingOrders = orders.filter((o) => o.status === "processing");
    const confirmedOrders = orders.filter((o) => o.status === "confirmed");
    const pendingOrders = orders.filter((o) => o.status === "pending");
    const holdOrders = orders.filter((o) => o.status === "hold");

    const totalRevenue = validOrders.reduce(
      (sum, o) => sum + Number(o.totalPrice || 0),
      0,
    );

    const totalDiscountGiven = orders.reduce(
      (sum, o) => sum + Number(o.discountAmount || 0),
      0,
    );

    const totalShippingCollected = validOrders.reduce(
      (sum, o) => sum + Number(o.shippingCharge || 0),
      0,
    );

    const averageOrderValue =
      validOrders.length > 0 ? Math.round(totalRevenue / validOrders.length) : 0;

    const deliverySuccessRate =
      orders.length > 0
        ? Math.round((deliveredOrders.length / orders.length) * 100)
        : 0;

    const returnOrCancelRate =
      orders.length > 0
        ? Math.round((cancelledOrders.length / orders.length) * 100)
        : 0;

    // 2. Order Funnel Calculation
    // Stages: Placed -> Confirmed/Reviewed -> Dispatched/Shipped -> Delivered
    const totalPlaced = orders.length;
    const reachedConfirmed = orders.filter(
      (o) => o.status !== "cancelled" && o.status !== "pending",
    ).length;
    const reachedShipped = orders.filter(
      (o) => o.status === "shipped" || o.status === "delivered",
    ).length;
    const reachedDelivered = deliveredOrders.length;

    const orderFunnel = [
      {
        stage: "Placed Orders",
        count: totalPlaced,
        percentage: 100,
        dropOff: totalPlaced - reachedConfirmed,
        description: "Initial orders submitted by customers",
      },
      {
        stage: "Confirmed & In-Prep",
        count: reachedConfirmed + pendingOrders.length,
        percentage:
          totalPlaced > 0
            ? Math.round(((reachedConfirmed + pendingOrders.length) / totalPlaced) * 100)
            : 0,
        dropOff: cancelledOrders.length,
        description: "Orders validated and ready for packing",
      },
      {
        stage: "Dispatched / In-Transit",
        count: reachedShipped,
        percentage:
          totalPlaced > 0
            ? Math.round((reachedShipped / totalPlaced) * 100)
            : 0,
        dropOff: reachedShipped - reachedDelivered,
        description: "Parcels handed over to courier",
      },
      {
        stage: "Delivered Successfully",
        count: reachedDelivered,
        percentage:
          totalPlaced > 0
            ? Math.round((reachedDelivered / totalPlaced) * 100)
            : 0,
        dropOff: 0,
        description: "Successfully received and paid for",
      },
    ];

    // 3. Customer Repeat & Conversion Metrics
    const customerOrderMap = {};
    orders.forEach((o) => {
      const custKey =
        o.customer?.phone || o.customer?.email || (o.user ? o.user.toString() : null);
      if (custKey) {
        customerOrderMap[custKey] = (customerOrderMap[custKey] || 0) + 1;
      }
    });

    const uniqueCustomersCount = Object.keys(customerOrderMap).length;
    const repeatCustomersCount = Object.values(customerOrderMap).filter(
      (count) => count > 1,
    ).length;
    const repeatCustomerRate =
      uniqueCustomersCount > 0
        ? Math.round((repeatCustomersCount / uniqueCustomersCount) * 100)
        : 0;

    // 4. Timeline Aggregation (Daily or Monthly trends)
    const timelineMap = {};

    orders.forEach((order) => {
      if (!order.createdAt) return;
      const d = new Date(order.createdAt);
      const dateKey = d.toISOString().split("T")[0];

      if (!timelineMap[dateKey]) {
        timelineMap[dateKey] = {
          date: dateKey,
          revenue: 0,
          orders: 0,
          delivered: 0,
          cancelled: 0,
        };
      }

      timelineMap[dateKey].orders += 1;
      if (order.status !== "cancelled") {
        timelineMap[dateKey].revenue += Number(order.totalPrice || 0);
      }
      if (order.status === "delivered") {
        timelineMap[dateKey].delivered += 1;
      }
      if (order.status === "cancelled") {
        timelineMap[dateKey].cancelled += 1;
      }
    });

    const timelineData = Object.values(timelineMap).sort(
      (a, b) => new Date(a.date) - new Date(b.date),
    );

    // 5. Status Distribution for Donut Chart
    const statusCounts = {
      pending: pendingOrders.length,
      confirmed: confirmedOrders.length,
      processing: processingOrders.length,
      shipped: shippedOrders.length,
      delivered: deliveredOrders.length,
      hold: holdOrders.length,
      cancelled: cancelledOrders.length,
    };

    const statusData = Object.entries(statusCounts)
      .filter(([_, count]) => count > 0)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        status: name,
        value,
      }));

    // 6. Payment Method Distribution
    const paymentMap = { cod: 0, online: 0, other: 0 };
    orders.forEach((o) => {
      const m = (o.paymentMethod || "cod").toLowerCase();
      if (m === "cod") paymentMap.cod += 1;
      else if (m === "online" || m === "zinpay") paymentMap.online += 1;
      else paymentMap.other += 1;
    });

    const paymentData = [
      { name: "Cash on Delivery (COD)", value: paymentMap.cod, method: "cod" },
      { name: "Online Payment", value: paymentMap.online, method: "online" },
    ].filter((p) => p.value > 0);

    // 7. Product Sales Mapping (Top-Selling & Least-Selling)
    const productSalesMap = {};
    orders.forEach((order) => {
      if (order.status === "cancelled") return;
      (order.products || []).forEach((item) => {
        const id = item.productId?.toString() || item.productName;
        if (!productSalesMap[id]) {
          productSalesMap[id] = {
            productId: item.productId,
            name: item.productName || "Unnamed Product",
            image: item.image || null,
            quantity: 0,
            revenue: 0,
          };
        }
        productSalesMap[id].quantity += Number(item.quantity || 1);
        productSalesMap[id].revenue +=
          Number(item.price || 0) * Number(item.quantity || 1);
      });
    });

    const topSellingProducts = Object.values(productSalesMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8);

    // 8. Low stock and Least Selling (Dead Stock) analysis
    const productsList = await productCollection.find().toArray();
    let lowStockCount = 0;
    const lowStockAlerts = [];
    const allProductsVelocity = [];

    productsList.forEach((p) => {
      const pId = p._id.toString();
      const salesInfo = productSalesMap[pId] || { quantity: 0, revenue: 0 };

      // Compute total stock across all variants
      let totalStock = 0;
      let hasLowVariant = false;

      if (Array.isArray(p.variantDetails) && p.variantDetails.length > 0) {
        p.variantDetails.forEach((v) => {
          (v.sizes || []).forEach((s) => {
            const sizeStock = Number(s.stock || 0);
            totalStock += sizeStock;
            if (sizeStock <= 3) {
              hasLowVariant = true;
              lowStockAlerts.push({
                productName: p.productName,
                slug: p.slug,
                color: v.color,
                size: s.size,
                stock: sizeStock,
              });
            }
          });
        });
      } else {
        totalStock = Number(p.stock || 0);
        if (totalStock <= 3) {
          hasLowVariant = true;
          lowStockAlerts.push({
            productName: p.productName,
            slug: p.slug,
            stock: totalStock,
          });
        }
      }

      if (hasLowVariant) lowStockCount += 1;

      allProductsVelocity.push({
        productId: p._id,
        name: p.productName,
        slug: p.slug,
        category: p.category,
        price: p.price,
        image:
          p.productImages?.[0] ||
          p.variantDetails?.[0]?.swatchImage ||
          null,
        stock: totalStock,
        quantitySold: salesInfo.quantity,
        revenue: salesInfo.revenue,
      });
    });

    // Least selling: sort by lowest units sold, but has stock in warehouse (slow movers/dead inventory)
    const leastSellingProducts = allProductsVelocity
      .filter((p) => p.stock > 0)
      .sort((a, b) => a.quantitySold - b.quantitySold || b.stock - a.stock)
      .slice(0, 8);

    // 9. Coupon Usage Summary
    const couponUsage = await couponCollection
      .find({ usedCount: { $gt: 0 } })
      .project({ code: 1, title: 1, usedCount: 1, totalDiscountGiven: 1 })
      .sort({ usedCount: -1 })
      .limit(5)
      .toArray();

    return res.status(200).json({
      success: true,
      data: {
        kpis: {
          totalRevenue,
          totalOrders: orders.length,
          validOrders: validOrders.length,
          averageOrderValue,
          deliveredOrders: deliveredOrders.length,
          pendingOrders: pendingOrders.length,
          processingOrders: processingOrders.length,
          shippedOrders: shippedOrders.length,
          cancelledOrders: cancelledOrders.length,
          deliverySuccessRate,
          returnOrCancelRate,
          totalDiscountGiven,
          totalShippingCollected,
          totalProductsCount,
          totalUsersCount,
          uniqueCustomersCount,
          repeatCustomersCount,
          repeatCustomerRate,
          lowStockCount,
        },
        orderFunnel,
        timelineData,
        statusData,
        paymentData,
        topSellingProducts,
        leastSellingProducts,
        lowStockAlerts: lowStockAlerts.slice(0, 10),
        couponUsage,
      },
    });
  } catch (error) {
    console.error("Analytics summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate analytics summary",
      error: error.message,
    });
  }
};

/**
 * Detailed Reports Export Generator
 * Supports types: "sales", "orders", "products"
 */
export const exportAnalyticsReport = async (req, res) => {
  try {
    const { type = "sales", range = "30d", startDate, endDate } = req.query;
    const dateFilter = getDateRangeFilter(range, startDate, endDate);

    if (type === "orders") {
      const orders = await orderCollection
        .find(dateFilter)
        .sort({ createdAt: -1 })
        .toArray();

      const headers = [
        "Order ID",
        "Date",
        "Customer Name",
        "Phone",
        "District",
        "Thana",
        "Items Count",
        "Subtotal",
        "Shipping Charge",
        "Discount",
        "Total Price",
        "Status",
        "Payment Status",
        "Payment Method",
        "Courier Tracking",
      ];

      const rows = orders.map((o) => {
        const custName = `${o.customer?.firstName || ""} ${o.customer?.lastName || ""} ${o.customer?.name || ""}`.trim() || "Guest";
        const itemsCount = (o.products || []).reduce(
          (sum, p) => sum + Number(p.quantity || 1),
          0,
        );
        return [
          `"${o._id?.toString()}"`,
          `"${new Date(o.createdAt).toLocaleDateString()}"`,
          `"${custName.replace(/"/g, '""')}"`,
          `"${(o.customer?.phone || "").replace(/"/g, '""')}"`,
          `"${(o.customer?.district || "").replace(/"/g, '""')}"`,
          `"${(o.customer?.thana || "").replace(/"/g, '""')}"`,
          itemsCount,
          o.subtotal || 0,
          o.shippingCharge || 0,
          o.discountAmount || 0,
          o.totalPrice || 0,
          `"${o.status || "pending"}"`,
          `"${o.paymentStatus || "unpaid"}"`,
          `"${o.paymentMethod || "cod"}"`,
          `"${o.steadfastTrackingCode || ""}"`,
        ].join(",");
      });

      const csvContent = [headers.join(","), ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=orders_report_${range}.csv`,
      );
      return res.status(200).send(csvContent);
    }

    if (type === "products") {
      const products = await productCollection.find().toArray();
      const orders = await orderCollection.find(dateFilter).toArray();

      const salesMap = {};
      orders.forEach((o) => {
        if (o.status === "cancelled") return;
        (o.products || []).forEach((p) => {
          const id = p.productId?.toString();
          if (id) {
            salesMap[id] = (salesMap[id] || 0) + Number(p.quantity || 1);
          }
        });
      });

      const headers = [
        "Product Name",
        "SKU",
        "Category",
        "Selling Price",
        "Discount Price",
        "Total Stock",
        "Units Sold (Selected Range)",
        "Revenue Generated (BDT)",
      ];

      const rows = products.map((p) => {
        const pId = p._id.toString();
        const unitsSold = salesMap[pId] || 0;
        const unitPrice = Number(p.discount || p.price || 0);
        const revenue = unitsSold * unitPrice;

        let totalStock = 0;
        if (Array.isArray(p.variantDetails)) {
          p.variantDetails.forEach((v) => {
            (v.sizes || []).forEach((s) => {
              totalStock += Number(s.stock || 0);
            });
          });
        } else {
          totalStock = Number(p.stock || 0);
        }

        return [
          `"${(p.productName || "").replace(/"/g, '""')}"`,
          `"${(p.sku || "N/A").replace(/"/g, '""')}"`,
          `"${(p.category || "").replace(/"/g, '""')}"`,
          p.price || 0,
          p.discount || 0,
          totalStock,
          unitsSold,
          revenue,
        ].join(",");
      });

      const csvContent = [headers.join(","), ...rows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=products_performance_report_${range}.csv`,
      );
      return res.status(200).send(csvContent);
    }

    // Default: Sales Summary
    const orders = await orderCollection
      .find(dateFilter)
      .sort({ createdAt: 1 })
      .toArray();

    const dailyMap = {};
    orders.forEach((o) => {
      const dateKey = new Date(o.createdAt).toISOString().split("T")[0];
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          totalOrders: 0,
          delivered: 0,
          cancelled: 0,
          revenue: 0,
          shipping: 0,
          discounts: 0,
        };
      }
      dailyMap[dateKey].totalOrders += 1;
      if (o.status !== "cancelled") {
        dailyMap[dateKey].revenue += Number(o.totalPrice || 0);
        dailyMap[dateKey].shipping += Number(o.shippingCharge || 0);
      }
      if (o.status === "delivered") {
        dailyMap[dateKey].delivered += 1;
      }
      if (o.status === "cancelled") {
        dailyMap[dateKey].cancelled += 1;
      }
      dailyMap[dateKey].discounts += Number(o.discountAmount || 0);
    });

    const headers = [
      "Date",
      "Total Orders",
      "Delivered Orders",
      "Cancelled Orders",
      "Gross Revenue (BDT)",
      "Shipping Fees (BDT)",
      "Discounts Given (BDT)",
    ];

    const rows = Object.values(dailyMap).map((d) => [
      d.date,
      d.totalOrders,
      d.delivered,
      d.cancelled,
      d.revenue,
      d.shipping,
      d.discounts,
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sales_summary_report_${range}.csv`,
    );
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error("Export report error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate report export",
      error: error.message,
    });
  }
};

/**
 * Handle incoming client Facebook CAPI event requests (ViewContent, AddToCart, InitiateCheckout, etc.)
 */
export const trackFacebookCapiEvent = async (req, res) => {
  try {
    const {
      eventName,
      eventId,
      eventSourceUrl,
      customData,
      customer,
      user,
      fbp,
      fbc,
    } = req.body || {};

    if (!eventName) {
      return res
        .status(400)
        .json({ success: false, message: "eventName is required" });
    }

    const result = await sendFacebookCapiEvent({
      eventName,
      eventId,
      eventSourceUrl,
      customData,
      customer,
      user,
      req,
      fbp,
      fbc,
    });

    return res.status(200).json({
      success: true,
      message: "Event processed",
      result,
    });
  } catch (error) {
    console.error("Facebook CAPI endpoint error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
