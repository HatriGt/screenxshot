import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import HomePage from "./routes/HomePage.jsx";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });
