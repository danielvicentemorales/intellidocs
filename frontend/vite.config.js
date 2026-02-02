import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // everything your frontend calls that belongs to FastAPI:
      "/health": "http://localhost:8000",
      "/documents": "http://localhost:8000",
      "/auth": "http://localhost:8000",

      // when you add chat later:
      "/chat": "http://localhost:8000",
    },
  },
});
