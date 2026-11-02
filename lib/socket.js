import { Server } from "socket.io";

let io = null;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: [
        "http://localhost:3000",
        "https://oiki-frontend.vercel.app",
        "https://oiki.store",
      ],
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Allow client to join user-specific or role-specific rooms
    socket.on("join:user", (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
      }
    });

    socket.on("join:admin", () => {
      socket.join("admins");
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => io;

export const emitRealtimeEvent = (event, payload = {}) => {
  if (io) {
    io.emit(event, {
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
};

