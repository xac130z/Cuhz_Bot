import "@auth/core/jwt";
import React from "react";
import path, { join } from "node:path";
import { renderToString } from "react-dom/server";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { route, index } from "@react-router/dev/routes";
import { serializeError } from "serialize-error";
import cleanStack from "clean-stack";
const __dirname$1 = fileURLToPath(new URL(".", import.meta.url));
function buildRouteTree(dir, basePath = "") {
  const files = readdirSync(dir);
  const node = {
    path: basePath,
    children: [],
    hasPage: false,
    isParam: false,
    isCatchAll: false,
    paramName: ""
  };
  const dirName = basePath.split("/").pop();
  if (dirName?.startsWith("[") && dirName.endsWith("]")) {
    node.isParam = true;
    const paramName = dirName.slice(1, -1);
    if (paramName.startsWith("...")) {
      node.isCatchAll = true;
      node.paramName = paramName.slice(3);
    } else {
      node.paramName = paramName;
    }
  }
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      const childPath = basePath ? `${basePath}/${file}` : file;
      const childNode = buildRouteTree(filePath, childPath);
      node.children.push(childNode);
    } else if (file === "page.jsx") {
      node.hasPage = true;
    }
  }
  return node;
}
function generateRoutes(node) {
  const routes2 = [];
  if (node.hasPage) {
    const componentPath = node.path === "" ? `./${node.path}page.jsx` : `./${node.path}/page.jsx`;
    if (node.path === "") {
      routes2.push(index(componentPath));
    } else {
      let routePath = node.path;
      const segments = routePath.split("/");
      const processedSegments = segments.map((segment) => {
        if (segment.startsWith("[") && segment.endsWith("]")) {
          const paramName = segment.slice(1, -1);
          if (paramName.startsWith("...")) {
            return "*";
          }
          if (paramName.startsWith("[") && paramName.endsWith("]")) {
            return `:${paramName.slice(1, -1)}?`;
          }
          return `:${paramName}`;
        }
        return segment;
      });
      routePath = processedSegments.join("/");
      routes2.push(route(routePath, componentPath));
    }
  }
  for (const child of node.children) {
    routes2.push(...generateRoutes(child));
  }
  return routes2;
}
const tree = buildRouteTree(__dirname$1);
const notFound = route("*?", "./__create/not-found.tsx");
const routes = [...generateRoutes(tree), notFound];
function serializeClean(err) {
  err.stack = cleanStack(err.stack, {
    pathFilter: (path2) => {
      return !path2.includes("node_modules") && !path2.includes("dist") && !path2.includes("__create");
    }
  });
  return serializeError(err);
}
const getHTMLOrError = (component) => {
  try {
    const html = renderToString(React.createElement(component, {}));
    return {
      html,
      error: null
    };
  } catch (error) {
    return {
      html: null,
      error: serializeClean(error)
    };
  }
};
async function GET(request) {
  const results = await Promise.allSettled(routes.map(async (route2) => {
    let component = null;
    try {
      const response = await import(
        /* @vite-ignore */
        path.join("../../../", route2.file)
      );
      component = response.default;
    } catch (error) {
      console.debug("Error importing component:", route2.file, error);
    }
    if (!component) {
      return null;
    }
    getHTMLOrError(component);
    return {
      route: route2.file,
      path: route2.path,
      ...getHTMLOrError(component)
    };
  }));
  const cleanedResults = results.filter((result) => result.status === "fulfilled").map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return null;
  }).filter((result) => result !== null);
  return Response.json({
    results: cleanedResults
  });
}
export {
  GET
};
