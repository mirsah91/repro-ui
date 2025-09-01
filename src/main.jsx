import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App.jsx";
import ChunkReplay from "./pages/ChunkReplay.jsx";
import "./index.css";

const router = createBrowserRouter([
    { path: "/", element: <App /> },
    { path: "/test-chunk", element: <ChunkReplay /> }, // ← new route
]);

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>
);
