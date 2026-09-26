import { jsx, Fragment, jsxs } from "react/jsx-runtime";
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter, UNSAFE_withComponentProps, Outlet, useNavigate, useLocation, Meta, Links, ScrollRestoration, Scripts, useRouteError, useAsyncError } from "react-router";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import { useButton } from "@react-aria/button";
import React, { useState, useEffect, Component, useRef, useCallback, useMemo } from "react";
import { f as fetchWithHeaders } from "./index-o0VDmD7y.js";
import { SessionProvider } from "@hono/auth-js/react";
import { toPng } from "html-to-image";
import { serializeError } from "serialize-error";
import { Toaster, toast } from "sonner";
import { useIdleTimer } from "react-idle-timer";
import { QueryClientProvider, QueryClient, useQueryClient, useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import _JSXStyle from "styled-jsx/style.js";
import { Zap, User, Loader2, Upload, Sparkles, Maximize2, ArrowUpDown, RotateCcw, ZoomIn, MoveHorizontal, MoveVertical, AlertCircle, Save, Download, MessageCircle, ExternalLink, Move } from "lucide-react";
import { HexColorPicker } from "react-colorful";
import fg from "fast-glob";
import "node:async_hooks";
import "node:console";
import "@auth/core";
import "@auth/core/providers/credentials";
import "@hono/auth-js";
import "@neondatabase/serverless";
import "argon2";
import "hono";
import "hono/context-storage";
import "hono/cors";
import "hono/proxy";
import "hono/body-limit";
import "hono/request-id";
import "hono/factory";
import "@hono/node-server";
import "@hono/node-server/serve-static";
import "hono/logger";
import "ws";
const streamTimeout = 5e3;
function handleRequest(request, responseStatusCode, responseHeaders, routerContext, loadContext) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders
    });
  }
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    let userAgent = request.headers.get("user-agent");
    let readyOption = userAgent && isbot(userAgent) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    let timeoutId = setTimeout(
      () => abort(),
      streamTimeout + 1e3
    );
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(ServerRouter, { context: routerContext, url: request.url }),
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = void 0;
              callback();
            }
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          pipe(body);
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode
            })
          );
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        }
      }
    );
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
function LoadFonts() {
  return /* @__PURE__ */ jsx(Fragment, {});
}
function useDevServerHeartbeat() {
  useIdleTimer({
    throttle: 6e4 * 3,
    timeout: 6e4,
    onAction: () => {
      fetch("/", {
        method: "GET"
      }).catch((error) => {
      });
    }
  });
}
const links = () => [];
if (globalThis.window && globalThis.window !== void 0) {
  globalThis.window.fetch = fetchWithHeaders;
}
const LoadFontsSSR = LoadFonts;
function InternalErrorBoundary({
  error: errorArg
}) {
  const routeError = useRouteError();
  const asyncError = useAsyncError();
  const error = errorArg ?? asyncError ?? routeError;
  const [isOpen, setIsOpen] = useState(false);
  const shouldScale = typeof window !== "undefined" ? window.innerWidth < 768 : false;
  const scaleFactor = shouldScale ? 1.02 : 1;
  const copyButtonTextClass = shouldScale ? "text-sm" : "text-xs";
  const copyButtonPaddingClass = shouldScale ? "px-[10px] py-[5px]" : "px-[6px] py-[3px]";
  const postCountRef = useRef(0);
  const lastPostTimeRef = useRef(0);
  const lastErrorKeyRef = useRef(null);
  const MAX_ERROR_POSTS_PER_ERROR = 5;
  const THROTTLE_MS = 1e3;
  useEffect(() => {
    const serialized = serializeError(error);
    const errorKey = JSON.stringify(serialized);
    if (errorKey !== lastErrorKeyRef.current) {
      lastErrorKeyRef.current = errorKey;
      postCountRef.current = 0;
    }
    if (postCountRef.current >= MAX_ERROR_POSTS_PER_ERROR) {
      return;
    }
    const now = Date.now();
    const timeSinceLastPost = now - lastPostTimeRef.current;
    const post = () => {
      if (postCountRef.current >= MAX_ERROR_POSTS_PER_ERROR) {
        return;
      }
      postCountRef.current += 1;
      lastPostTimeRef.current = Date.now();
      window.parent.postMessage({
        type: "sandbox:error:detected",
        error: serialized
      }, "*");
    };
    if (timeSinceLastPost < THROTTLE_MS) {
      const timer = setTimeout(post, THROTTLE_MS - timeSinceLastPost);
      return () => clearTimeout(timer);
    }
    post();
  }, [error]);
  useEffect(() => {
    const animateTimer = setTimeout(() => setIsOpen(true), 100);
    return () => clearTimeout(animateTimer);
  }, []);
  const {
    buttonProps: copyButtonProps
  } = useButton({
    onPress: useCallback(() => {
      const toastScale = shouldScale ? 1.2 : 1;
      const toastStyle = {
        padding: `${16 * toastScale}px`,
        background: "#18191B",
        border: "1px solid #2C2D2F",
        color: "white",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        width: `${280 * toastScale}px`,
        fontSize: `${13 * toastScale}px`,
        display: "flex",
        alignItems: "center",
        gap: `${6 * toastScale}px`,
        justifyContent: "flex-start",
        margin: "0 auto"
      };
      navigator.clipboard.writeText(JSON.stringify(serializeError(error)));
      toast.custom(() => /* @__PURE__ */ jsxs("div", {
        style: toastStyle,
        children: [/* @__PURE__ */ jsxs("svg", {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 20 20",
          fill: "currentColor",
          height: "20",
          width: "20",
          children: [/* @__PURE__ */ jsx("title", {
            children: "Success"
          }), /* @__PURE__ */ jsx("path", {
            fillRule: "evenodd",
            d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z",
            clipRule: "evenodd"
          })]
        }), /* @__PURE__ */ jsx("span", {
          children: "Copied successfully!"
        })]
      }), {
        id: "copy-error-success",
        duration: 3e3
      });
    }, [error, shouldScale])
  }, useRef(null));
  function isInIframe() {
    try {
      return window.parent !== window;
    } catch {
      return true;
    }
  }
  return /* @__PURE__ */ jsx(Fragment, {
    children: !isInIframe() && /* @__PURE__ */ jsx("div", {
      className: `fixed bottom-4 left-1/2 transform -translate-x-1/2 max-w-md z-50 transition-all duration-500 ease-out ${isOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"}`,
      style: {
        width: "75vw"
      },
      children: /* @__PURE__ */ jsx("div", {
        className: "bg-[#18191B] text-[#F2F2F2] rounded-lg p-4 shadow-lg w-full",
        style: scaleFactor !== 1 ? {
          transform: `scale(${scaleFactor})`,
          transformOrigin: "bottom center"
        } : void 0,
        children: /* @__PURE__ */ jsxs("div", {
          className: "flex items-start gap-3",
          children: [/* @__PURE__ */ jsx("div", {
            className: "flex-shrink-0",
            children: /* @__PURE__ */ jsx("div", {
              className: "w-8 h-8 bg-[#F2F2F2] rounded-full flex items-center justify-center",
              children: /* @__PURE__ */ jsx("span", {
                className: "text-black text-[1.125rem] leading-none",
                children: "!"
              })
            })
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex flex-col gap-2 flex-1",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "flex flex-col gap-1",
              children: [/* @__PURE__ */ jsx("p", {
                className: "font-light text-[#F2F2F2] text-sm",
                children: "App Error Detected"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[#959697] text-sm font-light",
                children: "It looks like an error occurred while trying to use your app."
              })]
            }), /* @__PURE__ */ jsx("button", {
              className: `flex flex-row items-center justify-center gap-[4px] outline-none transition-colors rounded-[8px] border-[1px] bg-[#2C2D2F] hover:bg-[#414243] active:bg-[#555658] border-[#414243] text-white ${copyButtonTextClass} ${copyButtonPaddingClass} w-fit`,
              type: "button",
              ...copyButtonProps,
              children: "Copy error"
            })]
          })]
        })
      })
    })
  });
}
class ErrorBoundaryWrapper extends Component {
  state = {
    hasError: false,
    error: null
  };
  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error
    };
  }
  componentDidCatch(error, info) {
    console.error(error, info);
  }
  render() {
    if (this.state.hasError) {
      return /* @__PURE__ */ jsx(InternalErrorBoundary, {
        error: this.state.error,
        params: {}
      });
    }
    return this.props.children;
  }
}
function LoaderWrapper({
  loader: loader2
}) {
  return /* @__PURE__ */ jsx(Fragment, {
    children: loader2()
  });
}
const ClientOnly = ({
  loader: loader2
}) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  if (!isMounted) return null;
  return /* @__PURE__ */ jsx(ErrorBoundaryWrapper, {
    children: /* @__PURE__ */ jsx(LoaderWrapper, {
      loader: loader2
    })
  });
};
function useHmrConnection() {
  const [connected, setConnected] = useState(() => false);
  useEffect(() => {
    return;
  }, []);
  return connected;
}
const healthyResponseType = "sandbox:web:healthcheck:response";
const useHandshakeParent = () => {
  const isHmrConnected = useHmrConnection();
  useEffect(() => {
    const healthyResponse = {
      type: healthyResponseType,
      healthy: isHmrConnected,
      supportsErrorDetected: true
    };
    const handleMessage = (event) => {
      if (event.data.type === "sandbox:web:healthcheck") {
        window.parent.postMessage(healthyResponse, "*");
      }
    };
    window.addEventListener("message", handleMessage);
    window.parent.postMessage(healthyResponse, "*");
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [isHmrConnected]);
};
const waitForScreenshotReady = async () => {
  const images = Array.from(document.images);
  await Promise.all([
    // make sure custom fonts are loaded
    "fonts" in document ? document.fonts.ready : Promise.resolve(),
    ...images.map((img) => new Promise((resolve) => {
      img.crossOrigin = "anonymous";
      if (img.complete) {
        resolve(true);
        return;
      }
      img.onload = () => resolve(true);
      img.onerror = () => resolve(true);
    }))
  ]);
  await new Promise((resolve) => setTimeout(resolve, 250));
};
const useHandleScreenshotRequest = () => {
  useEffect(() => {
    const handleMessage = async (event) => {
      if (event.data.type === "sandbox:web:screenshot:request") {
        try {
          await waitForScreenshotReady();
          const width = window.innerWidth;
          const aspectRatio = 16 / 9;
          const height = Math.floor(width / aspectRatio);
          const dataUrl = await toPng(document.body, {
            cacheBust: true,
            skipFonts: false,
            width,
            height,
            style: {
              // force snapshot sizing
              width: `${width}px`,
              height: `${height}px`,
              margin: "0"
            }
          });
          window.parent.postMessage({
            type: "sandbox:web:screenshot:response",
            dataUrl
          }, "*");
        } catch (error) {
          window.parent.postMessage({
            type: "sandbox:web:screenshot:error",
            error: error instanceof Error ? error.message : String(error)
          }, "*");
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);
};
function Layout({
  children
}) {
  useHandshakeParent();
  useHandleScreenshotRequest();
  useDevServerHeartbeat();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location?.pathname;
  const isMobile = typeof window !== "undefined" ? window.innerWidth < 768 : false;
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data.type === "sandbox:navigation") {
        navigate(event.data.pathname);
      }
    };
    window.addEventListener("message", handleMessage);
    window.parent.postMessage({
      type: "sandbox:web:ready"
    }, "*");
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [navigate]);
  useEffect(() => {
    if (pathname) {
      window.parent.postMessage({
        type: "sandbox:web:navigation",
        pathname
      }, "*");
    }
  }, [pathname]);
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    children: [/* @__PURE__ */ jsxs("head", {
      children: [/* @__PURE__ */ jsx("meta", {
        charSet: "utf-8"
      }), /* @__PURE__ */ jsx("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1"
      }), /* @__PURE__ */ jsx(Meta, {}), /* @__PURE__ */ jsx(Links, {}), /* @__PURE__ */ jsx("script", {
        type: "module",
        src: "/src/__create/dev-error-overlay.js"
      }), /* @__PURE__ */ jsx("link", {
        rel: "icon",
        href: "/src/__create/favicon.png"
      }), LoadFontsSSR ? /* @__PURE__ */ jsx(LoadFontsSSR, {}) : null]
    }), /* @__PURE__ */ jsxs("body", {
      children: [/* @__PURE__ */ jsx(ClientOnly, {
        loader: () => children
      }), /* @__PURE__ */ jsx(Toaster, {
        position: isMobile ? "top-center" : "bottom-right"
      }), /* @__PURE__ */ jsx(ScrollRestoration, {}), /* @__PURE__ */ jsx(Scripts, {}), /* @__PURE__ */ jsx("script", {
        src: "https://kit.fontawesome.com/2c15cc0cc7.js",
        crossOrigin: "anonymous",
        async: true
      })]
    })]
  });
}
const root = UNSAFE_withComponentProps(function App() {
  return /* @__PURE__ */ jsx(SessionProvider, {
    children: /* @__PURE__ */ jsx(Outlet, {})
  });
});
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ClientOnly,
  Layout,
  default: root,
  links,
  useHandleScreenshotRequest,
  useHmrConnection
}, Symbol.toStringTag, { value: "Module" }));
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1e3 * 60 * 5,
      // 5 minutes
      cacheTime: 1e3 * 60 * 30,
      // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});
function RootLayout({
  children
}) {
  return /* @__PURE__ */ jsxs(QueryClientProvider, { client: queryClient, children: [
    children,
    /* @__PURE__ */ jsx(Toaster, { richColors: true, position: "top-center" })
  ] });
}
function Page() {
  return null;
}
const page$a = UNSAFE_withComponentProps(function WrappedPage(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(Page, {
      ...props
    })
  });
});
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$a
}, Symbol.toStringTag, { value: "Module" }));
function useTwitchAuth() {
  const queryClient2 = useQueryClient();
  const {
    data,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const response = await fetch("/api/auth/me", {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`When fetching /api/auth/me, the response was [${response.status}] ${response.statusText}`);
      }
      return response.json();
    }
  });
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(`When logging out, the response was [${response.status}] ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient2.invalidateQueries({
        queryKey: ["me"]
      });
      window.location.href = "/";
    },
    onError: (err) => {
      console.error(err);
      alert("Could not log out. Please try again.");
    }
  });
  const logout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);
  return {
    user: data?.user ?? null,
    loading: isLoading,
    isAuthenticated: !!data?.user,
    error,
    logout,
    refetch
  };
}
async function startTwitchLogin() {
  try {
    const response = await fetch("/api/auth/twitch?format=json");
    if (!response.ok) {
      throw new Error(`Failed to get Twitch login URL: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.url) {
      throw new Error("No authorization URL received from server");
    }
    window.location.href = data.url;
  } catch (error) {
    console.error("Could not start Twitch login:", error);
    toast.error("Could not start Twitch login, please try again.");
  }
}
function AdminPage() {
  const {
    user,
    loading,
    logout
  } = useTwitchAuth();
  const notAdmin = !loading && user && user.role !== "admin";
  const queryClient2 = useQueryClient();
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("all");
  const [style, setStyle] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userQ, setUserQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [changes, setChanges] = useState({});
  const handleChange = (id, field, value) => {
    setChanges((prev) => ({
      ...prev,
      [id]: {
        ...prev[id] || {},
        [field]: value
      }
    }));
  };
  const {
    data: gensData,
    isLoading: gensLoading,
    isError: gensError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchGens
  } = useInfiniteQuery({
    queryKey: ["admin-generations", {
      q,
      method,
      style,
      dateFrom,
      dateTo
    }],
    queryFn: async ({
      pageParam
    }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (q) params.set("q", q);
      if (method !== "all") params.set("method", method);
      if (style) params.set("style", style);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/admin/generations?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin generations failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    getNextPageParam: (last) => last?.nextCursor ?? void 0,
    enabled: !!user && user.role === "admin"
  });
  const gensItems = useMemo(() => (gensData?.pages || []).flatMap((p) => p.items || []), [gensData]);
  const {
    data: usersData,
    isLoading: usersLoading,
    isError: usersError,
    fetchNextPage: fetchNextUsers,
    hasNextPage: hasNextUsers,
    isFetchingNextPage: fetchingNextUsers,
    refetch: refetchUsers
  } = useInfiniteQuery({
    queryKey: ["admin-users", {
      userQ,
      roleFilter,
      planFilter
    }],
    queryFn: async ({
      pageParam
    }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (userQ) params.set("q", userQ);
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (planFilter !== "all") params.set("plan", planFilter);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin users failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    getNextPageParam: (last) => last?.nextCursor ?? void 0,
    enabled: !!user && user.role === "admin"
  });
  const userItems = useMemo(() => (usersData?.pages || []).flatMap((p) => p.items || []), [usersData]);
  const saveUserMutation = useMutation({
    mutationFn: async ({
      id,
      patch
    }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(patch)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Update failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Saved changes");
      setChanges({});
      queryClient2.invalidateQueries({
        queryKey: ["admin-users"]
      });
    },
    onError: (err) => {
      console.error(err);
      toast.error("Could not save changes");
    }
  });
  const {
    data: botInfoData,
    isLoading: botInfoLoading,
    isError: botInfoError,
    refetch: refetchBotInfo
  } = useQuery({
    queryKey: ["admin-bot-info"],
    queryFn: async () => {
      const res = await fetch("http://localhost:3000/api/system-status");
      if (!res.ok) {
        throw new Error(`Bot info failed: [${res.status}]`);
      }
      return res.json();
    },
    enabled: !!user && user.role === "admin",
    refetchInterval: 1e4
    // refresh every 10 seconds
  });
  const [errQ, setErrQ] = useState("");
  const [errScope, setErrScope] = useState("");
  const [errCode, setErrCode] = useState("");
  const [errFrom, setErrFrom] = useState("");
  const [errTo, setErrTo] = useState("");
  const {
    data: errsData,
    isLoading: errsLoading,
    isError: errsError,
    fetchNextPage: fetchNextErrs,
    hasNextPage: hasNextErrs,
    isFetchingNextPage: fetchingNextErrs,
    refetch: refetchErrs
  } = useInfiniteQuery({
    queryKey: ["admin-errors", {
      errQ,
      errScope,
      errCode,
      errFrom,
      errTo
    }],
    queryFn: async ({
      pageParam
    }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (errQ) params.set("q", errQ);
      if (errScope) params.set("scope", errScope);
      if (errCode) params.set("code", errCode);
      if (errFrom) params.set("dateFrom", errFrom);
      if (errTo) params.set("dateTo", errTo);
      if (pageParam) params.set("cursor", String(pageParam));
      const res = await fetch(`/api/admin/errors?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin errors failed: [${res.status}] ${text}`);
      }
      return res.json();
    },
    getNextPageParam: (last) => last?.nextCursor ?? void 0,
    enabled: !!user && user.role === "admin"
  });
  const errItems = useMemo(() => (errsData?.pages || []).flatMap((p) => p.items || []), [errsData]);
  return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white", style: {
    backgroundColor: "#0a0e27"
  }, children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: {
      background: "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)"
    } }),
    /* @__PURE__ */ jsxs("div", { className: "max-w-[1200px] mx-auto px-6 py-10", children: [
      /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between", children: [
        /* @__PURE__ */ jsxs("a", { href: "/", className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsx("img", { src: "https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/", alt: "Planet Cuhz logo", className: "h-10 w-auto rounded-sm" }),
          /* @__PURE__ */ jsx("span", { className: "text-lg font-semibold tracking-wide", children: "Admin" })
        ] }),
        loading ? /* @__PURE__ */ jsx("div", { className: "px-4 py-2 rounded-xl border border-white/15", children: "Loading..." }) : user ? /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            user.profile_image_url && /* @__PURE__ */ jsx("img", { src: user.profile_image_url, alt: user.display_name || user.username, className: "w-8 h-8 rounded-full" }),
            /* @__PURE__ */ jsxs("span", { className: "text-sm", children: [
              user.display_name || user.username,
              user.role === "admin" && /* @__PURE__ */ jsx("span", { className: "ml-1 text-xs bg-gradient-to-r from-[#00f5ff] to-[#b24bf3] text-black px-2 py-0.5 rounded-full font-semibold", children: "ADMIN" })
            ] })
          ] }),
          /* @__PURE__ */ jsx("button", { onClick: logout, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Logout" })
        ] }) : /* @__PURE__ */ jsx("button", { onClick: startTwitchLogin, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors", children: "Login with Twitch" })
      ] }),
      notAdmin && /* @__PURE__ */ jsx("div", { className: "mt-6 rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-white/80", children: "You are signed in, but not an admin. If you should have access, ask an existing admin to promote your account." }),
      user && user.role === "admin" && /* @__PURE__ */ jsxs("section", { className: "mt-8 rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Users" }),
        /* @__PURE__ */ jsxs("div", { className: "mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm", children: [
          /* @__PURE__ */ jsx("input", { value: userQ, onChange: (e) => setUserQ(e.target.value), placeholder: "Search users (name or twitch id)", className: "rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
          /* @__PURE__ */ jsxs("select", { value: roleFilter, onChange: (e) => setRoleFilter(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", children: [
            /* @__PURE__ */ jsx("option", { value: "all", children: "All roles" }),
            /* @__PURE__ */ jsx("option", { value: "user", children: "User" }),
            /* @__PURE__ */ jsx("option", { value: "streamer", children: "Streamer" }),
            /* @__PURE__ */ jsx("option", { value: "admin", children: "Admin" })
          ] }),
          /* @__PURE__ */ jsxs("select", { value: planFilter, onChange: (e) => setPlanFilter(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", children: [
            /* @__PURE__ */ jsx("option", { value: "all", children: "Any plan" }),
            /* @__PURE__ */ jsx("option", { value: "pro", children: "Pro" }),
            /* @__PURE__ */ jsx("option", { value: "free", children: "Free" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "md:col-span-2 flex gap-2", children: [
            /* @__PURE__ */ jsx("button", { onClick: () => refetchUsers(), className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30", children: "Apply" }),
            hasNextUsers && /* @__PURE__ */ jsx("button", { onClick: () => fetchNextUsers(), disabled: fetchingNextUsers, className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50", children: fetchingNextUsers ? "Loading…" : "Load more" })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mt-4 overflow-x-auto", children: usersLoading ? /* @__PURE__ */ jsx("div", { className: "text-sm text-white/70", children: "Loading…" }) : usersError ? /* @__PURE__ */ jsx("div", { className: "text-sm text-red-300", children: "Could not load users" }) : userItems.length === 0 ? /* @__PURE__ */ jsx("div", { className: "text-sm text-white/70", children: "No results" }) : /* @__PURE__ */ jsxs("table", { className: "w-full text-sm", children: [
          /* @__PURE__ */ jsx("thead", { className: "text-white/60", children: /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "User" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Twitch" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Role" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "AI Limit" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Plan" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Totals" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Today" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Last" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Actions" })
          ] }) }),
          /* @__PURE__ */ jsx("tbody", { children: userItems.map((u) => {
            const c = changes[u.id] || {};
            const roleVal = c.role ?? u.role;
            const limVal = c.ai_limit_override ?? u.ai_limit_override ?? "";
            return /* @__PURE__ */ jsxs("tr", { className: "border-t border-white/10", children: [
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
                u.profile_image_url && /* @__PURE__ */ jsx("img", { src: u.profile_image_url, alt: u.display_name || u.username, className: "w-8 h-8 rounded-full" }),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("div", { children: u.display_name || u.username || "-" }),
                  /* @__PURE__ */ jsxs("div", { className: "text-white/50 text-xs", children: [
                    "id: ",
                    u.id
                  ] })
                ] })
              ] }) }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3 text-xs", children: u.twitch_id || "" }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: /* @__PURE__ */ jsxs("select", { value: roleVal, onChange: (e) => handleChange(u.id, "role", e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-2 py-1", children: [
                /* @__PURE__ */ jsx("option", { value: "user", children: "User" }),
                /* @__PURE__ */ jsx("option", { value: "streamer", children: "Streamer" }),
                /* @__PURE__ */ jsx("option", { value: "admin", children: "Admin" })
              ] }) }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: /* @__PURE__ */ jsx("input", { type: "number", inputMode: "numeric", placeholder: "(null)", value: limVal, onChange: (e) => handleChange(u.id, "ai_limit_override", e.target.value), className: "w-24 rounded-xl border border-white/15 bg-transparent px-2 py-1", min: 0 }) }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: /* @__PURE__ */ jsx("div", { className: "flex items-center gap-2", children: /* @__PURE__ */ jsx("span", { className: "uppercase", children: u.plan === "pro" ? "PRO" : "FREE" }) }) }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: u.total_generations }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: u.generations_today }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: u.last_generated_at ? new Date(u.last_generated_at).toLocaleString() : "-" }),
              /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: /* @__PURE__ */ jsx("button", { onClick: () => saveUserMutation.mutate({
                id: u.id,
                patch: changes[u.id] || {}
              }), disabled: !changes[u.id] || saveUserMutation.isLoading, className: "px-3 py-1 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50", children: "Save" }) })
            ] }, u.id);
          }) })
        ] }) })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6", children: [
        /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-5", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Global Marketing Messages" }),
          /* @__PURE__ */ jsxs("div", { className: "mt-4 grid gap-3", children: [
            /* @__PURE__ */ jsx("input", { className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", placeholder: "Message (rotates every 30m)", disabled: notAdmin }),
            /* @__PURE__ */ jsx("input", { className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", placeholder: "Another message", disabled: notAdmin }),
            /* @__PURE__ */ jsx("button", { className: "mt-2 w-fit px-4 py-2 rounded-xl font-semibold text-black disabled:opacity-50", style: {
              background: "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)"
            }, disabled: notAdmin, children: "Save" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-5", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Global Commands" }),
          /* @__PURE__ */ jsxs("div", { className: "mt-4 grid gap-3", children: [
            /* @__PURE__ */ jsx("textarea", { rows: 3, className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", placeholder: "!cuhz response", disabled: notAdmin }),
            /* @__PURE__ */ jsx("textarea", { rows: 3, className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", placeholder: "!chain response", disabled: notAdmin }),
            /* @__PURE__ */ jsx("textarea", { rows: 3, className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", placeholder: "!discord response", disabled: notAdmin }),
            /* @__PURE__ */ jsx("button", { className: "mt-2 w-fit px-4 py-2 rounded-xl font-semibold text-black disabled:opacity-50", style: {
              background: "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)"
            }, disabled: notAdmin, children: "Save" })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "mt-8 rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Channels Using CuhzBot" }),
        /* @__PURE__ */ jsx("div", { className: "mt-4 text-sm text-white/80", children: "Coming soon" })
      ] }),
      user && user.role === "admin" && /* @__PURE__ */ jsxs("section", { className: "mt-8 rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Recent Generations" }),
        /* @__PURE__ */ jsxs("div", { className: "mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm", children: [
          /* @__PURE__ */ jsx("input", { value: q, onChange: (e) => setQ(e.target.value), placeholder: "Filter by user (name or twitch id)", className: "rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
          /* @__PURE__ */ jsxs("select", { value: method, onChange: (e) => setMethod(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", children: [
            /* @__PURE__ */ jsx("option", { value: "all", children: "All methods" }),
            /* @__PURE__ */ jsx("option", { value: "ai", children: "AI" }),
            /* @__PURE__ */ jsx("option", { value: "upload", children: "Upload" })
          ] }),
          /* @__PURE__ */ jsxs("select", { value: style, onChange: (e) => setStyle(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Any style" }),
            /* @__PURE__ */ jsx("option", { value: "rainbow", children: "Rainbow" }),
            /* @__PURE__ */ jsx("option", { value: "gold", children: "Gold" }),
            /* @__PURE__ */ jsx("option", { value: "silver", children: "Silver" }),
            /* @__PURE__ */ jsx("option", { value: "iced", children: "Iced" }),
            /* @__PURE__ */ jsx("option", { value: "custom", children: "Custom" })
          ] }),
          /* @__PURE__ */ jsx("input", { type: "date", value: dateFrom, onChange: (e) => setDateFrom(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsx("input", { type: "date", value: dateTo, onChange: (e) => setDateTo(e.target.value), className: "flex-1 rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
            /* @__PURE__ */ jsx("button", { onClick: () => refetchGens(), className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30", children: "Apply" })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mt-4 overflow-x-auto", children: gensLoading ? /* @__PURE__ */ jsx("div", { className: "text-sm text-white/70", children: "Loading…" }) : gensError ? /* @__PURE__ */ jsx("div", { className: "text-sm text-red-300", children: "Could not load generations" }) : gensItems.length === 0 ? /* @__PURE__ */ jsx("div", { className: "text-sm text-white/70", children: "No results" }) : /* @__PURE__ */ jsxs("table", { className: "w-full text-sm", children: [
          /* @__PURE__ */ jsx("thead", { className: "text-white/60", children: /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Image" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "User" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Method" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Style" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Prompt" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Date" })
          ] }) }),
          /* @__PURE__ */ jsx("tbody", { children: gensItems.map((g) => /* @__PURE__ */ jsxs("tr", { className: "border-t border-white/10", children: [
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: /* @__PURE__ */ jsx("a", { href: g.image_url, target: "_blank", rel: "noreferrer", children: /* @__PURE__ */ jsx("img", { src: g.image_url, alt: g.prompt || "generation", className: "w-16 h-16 object-cover rounded" }) }) }),
            /* @__PURE__ */ jsxs("td", { className: "py-2 pr-3", children: [
              /* @__PURE__ */ jsx("div", { children: g.display_name || g.username || "-" }),
              /* @__PURE__ */ jsx("div", { className: "text-white/50 text-xs", children: g.user_twitch_id || "" })
            ] }),
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3 uppercase", children: g.method }),
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: g.style || "-" }),
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3 max-w-[360px] truncate", title: g.prompt || "", children: g.prompt || "" }),
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: g.created_at ? new Date(g.created_at).toLocaleString() : "" })
          ] }, g.id)) })
        ] }) }),
        hasNextPage && /* @__PURE__ */ jsx("div", { className: "mt-4 flex justify-center", children: /* @__PURE__ */ jsx("button", { onClick: () => fetchNextPage(), disabled: isFetchingNextPage, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50", children: isFetchingNextPage ? "Loading…" : "Load more" }) })
      ] }),
      user && user.role === "admin" && /* @__PURE__ */ jsxs("section", { className: "mt-8 rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold flex items-center gap-2", children: "📡 Tri-Brain AI & Bot Tiers" }),
          /* @__PURE__ */ jsx("button", { onClick: () => refetchBotInfo(), disabled: botInfoLoading, className: "text-xs px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/5 transition-colors", children: botInfoLoading ? "Syncing..." : "Refresh Status" })
        ] }),
        botInfoError ? /* @__PURE__ */ jsx("div", { className: "mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-200", children: "Could not connect to Bot core (Is `bot.js` running on port 3000?)" }) : botInfoLoading && !botInfoData ? /* @__PURE__ */ jsx("div", { className: "mt-4 text-sm text-white/50", children: "Fetching bot intelligence..." }) : botInfoData ? /* @__PURE__ */ jsxs("div", { className: "mt-6 grid grid-cols-1 md:grid-cols-2 gap-6", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h3", { className: "text-sm font-semibold text-white/70 tracking-wide uppercase mb-3", children: "Tri-Brain Status" }),
            /* @__PURE__ */ jsxs("div", { className: "space-y-3", children: [
              /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/40", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
                /* @__PURE__ */ jsx("div", { className: `w-2.5 h-2.5 rounded-full ${botInfoData.ai?.gemini ? "bg-[#00f5ff] shadow-[0_0_8px_#00f5ff]" : "bg-red-500"}` }),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("div", { className: "font-medium text-sm", children: "The Eyes (Gemini 2.0 Flash)" }),
                  /* @__PURE__ */ jsx("div", { className: "text-xs text-white/50", children: botInfoData.ai?.gemini ? "API Key Active" : "Offline - Missing Key" })
                ] })
              ] }) }),
              /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/40", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
                /* @__PURE__ */ jsx("div", { className: `w-2.5 h-2.5 rounded-full ${botInfoData.ai?.claude ? "bg-[#b24bf3] shadow-[0_0_8px_#b24bf3]" : "bg-red-500"}` }),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("div", { className: "font-medium text-sm", children: "The Brain (Claude 3.5 Sonnet)" }),
                  /* @__PURE__ */ jsx("div", { className: "text-xs text-white/50", children: botInfoData.ai?.claude ? "API Key Active" : "Offline - Missing Key" })
                ] })
              ] }) }),
              /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between p-3 rounded-xl border border-white/10 bg-black/40", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
                /* @__PURE__ */ jsx("div", { className: `w-2.5 h-2.5 rounded-full ${botInfoData.ai?.qwen ? "bg-[#ff1493] shadow-[0_0_8px_#ff1493]" : "bg-red-500"}` }),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("div", { className: "font-medium text-sm", children: "The Hands (Qwen 2.5 Coder)" }),
                  /* @__PURE__ */ jsx("div", { className: "text-xs text-white/50", children: botInfoData.ai?.qwen ? "API Key Active" : "Offline - Missing Key" })
                ] })
              ] }) })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h3", { className: "text-sm font-semibold text-white/70 tracking-wide uppercase mb-3", children: "Active Channel Tiers" }),
            /* @__PURE__ */ jsx("div", { className: "grid grid-cols-2 gap-3", children: botInfoData.tiers && Object.entries(botInfoData.tiers).map(([channel, tier]) => {
              let badgeColor = "bg-white/10 text-white";
              if (tier === "premium") badgeColor = "bg-[#ffd700]/20 text-[#ffd700] border-[#ffd700]/50";
              if (tier === "pro") badgeColor = "bg-[#00f5ff]/20 text-[#00f5ff] border-[#00f5ff]/50";
              return /* @__PURE__ */ jsxs("div", { className: "p-3 rounded-xl border border-white/10 bg-black/40 flex flex-col justify-center", children: [
                /* @__PURE__ */ jsxs("div", { className: "font-medium text-sm truncate", children: [
                  "#",
                  channel
                ] }),
                /* @__PURE__ */ jsx("div", { className: "mt-1", children: /* @__PURE__ */ jsx("span", { className: `text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeColor}`, children: tier }) })
              ] }, channel);
            }) })
          ] })
        ] }) : null
      ] }),
      user && user.role === "admin" && /* @__PURE__ */ jsxs("section", { className: "mt-8 rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Error Logs" }),
        /* @__PURE__ */ jsxs("div", { className: "mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm", children: [
          /* @__PURE__ */ jsx("input", { value: errQ, onChange: (e) => setErrQ(e.target.value), placeholder: "Search message / code / scope", className: "rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
          /* @__PURE__ */ jsx("input", { value: errScope, onChange: (e) => setErrScope(e.target.value), placeholder: "Scope (e.g. ai_generate)", className: "rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
          /* @__PURE__ */ jsx("input", { value: errCode, onChange: (e) => setErrCode(e.target.value), placeholder: "Code (e.g. UNCAUGHT)", className: "rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
          /* @__PURE__ */ jsx("input", { type: "date", value: errFrom, onChange: (e) => setErrFrom(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsx("input", { type: "date", value: errTo, onChange: (e) => setErrTo(e.target.value), className: "flex-1 rounded-xl border border-white/15 bg-transparent px-3 py-2" }),
            /* @__PURE__ */ jsx("button", { onClick: () => refetchErrs(), className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30", children: "Apply" })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mt-4 overflow-x-auto", children: errsLoading ? /* @__PURE__ */ jsx("div", { className: "text-sm text-white/70", children: "Loading…" }) : errsError ? /* @__PURE__ */ jsx("div", { className: "text-sm text-red-300", children: "Could not load errors" }) : errItems.length === 0 ? /* @__PURE__ */ jsx("div", { className: "text-sm text-white/70", children: "No results" }) : /* @__PURE__ */ jsxs("table", { className: "w-full text-sm", children: [
          /* @__PURE__ */ jsx("thead", { className: "text-white/60", children: /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "When" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Scope" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Code" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "Message" }),
            /* @__PURE__ */ jsx("th", { className: "text-left py-2 pr-3", children: "User" })
          ] }) }),
          /* @__PURE__ */ jsx("tbody", { children: errItems.map((e) => /* @__PURE__ */ jsxs("tr", { className: "border-t border-white/10", children: [
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: e.created_at ? new Date(e.created_at).toLocaleString() : "" }),
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: e.scope || "" }),
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3", children: e.code || "" }),
            /* @__PURE__ */ jsx("td", { className: "py-2 pr-3 max-w-[420px] truncate", title: e.message || "", children: e.message || "" }),
            /* @__PURE__ */ jsxs("td", { className: "py-2 pr-3", children: [
              /* @__PURE__ */ jsx("div", { children: e.display_name || e.username || "-" }),
              /* @__PURE__ */ jsx("div", { className: "text-white/50 text-xs", children: e.user_twitch_id || "" })
            ] })
          ] }, e.id)) })
        ] }) }),
        hasNextErrs && /* @__PURE__ */ jsx("div", { className: "mt-4 flex justify-center", children: /* @__PURE__ */ jsx("button", { onClick: () => fetchNextErrs(), disabled: fetchingNextErrs, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50", children: fetchingNextErrs ? "Loading…" : "Load more" }) })
      ] })
    ] })
  ] });
}
const page$9 = UNSAFE_withComponentProps(function WrappedPage2(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(AdminPage, {
      ...props
    })
  });
});
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$9
}, Symbol.toStringTag, { value: "Module" }));
function PromoteFirstAdminPage() {
  const {
    user,
    loading
  } = useTwitchAuth();
  const [promoting, setPromoting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const handlePromoteToAdmin = async () => {
    if (!user) {
      setError("You must be logged in to promote yourself to admin");
      return;
    }
    setPromoting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/promote-first-admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to promote to admin");
      }
      setSuccess(true);
      setTimeout(() => {
        window.location.href = "/admin";
      }, 2e3);
    } catch (err) {
      console.error("Error promoting to admin:", err);
      setError(err.message);
    } finally {
      setPromoting(false);
    }
  };
  if (loading) {
    return /* @__PURE__ */ jsx("div", { className: "min-h-screen bg-[#0a0e27] text-white flex items-center justify-center", children: /* @__PURE__ */ jsx("div", { children: "Loading..." }) });
  }
  return /* @__PURE__ */ jsx("div", { className: "min-h-screen bg-[#0a0e27] text-white", children: /* @__PURE__ */ jsx("div", { className: "max-w-2xl mx-auto px-6 py-16", children: /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-8", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-3xl font-bold mb-6", children: "Promote First Admin" }),
    /* @__PURE__ */ jsxs("div", { className: "space-y-6", children: [
      /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-yellow-400 font-semibold mb-2", children: "⚠️ Important Security Notice" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-yellow-200", children: "This page allows you to promote yourself to admin status. This should only be used once to create the first admin user. After you become admin, you should delete this page for security reasons." })
      ] }),
      !user ? /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
        /* @__PURE__ */ jsx("p", { className: "mb-4", children: "You must be logged in with Twitch to promote yourself to admin." }),
        /* @__PURE__ */ jsx("a", { href: "/auth/twitch", className: "inline-block px-6 py-3 rounded-xl font-semibold text-black", style: {
          background: "linear-gradient(90deg, #00f5ff, #b24bf3, #ff1493, #ffd700)"
        }, children: "Login with Twitch" })
      ] }) : user.role === "admin" ? /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
        /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-green-500/20 bg-green-500/10 p-4 mb-4", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-green-400 font-semibold mb-2", children: "✅ Already Admin" }),
          /* @__PURE__ */ jsx("p", { className: "text-sm text-green-200", children: "You are already an admin! You can now delete this page for security." })
        ] }),
        /* @__PURE__ */ jsx("a", { href: "/admin", className: "inline-block px-6 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors", children: "Go to Admin Panel" })
      ] }) : success ? /* @__PURE__ */ jsx("div", { className: "text-center", children: /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-green-500/20 bg-green-500/10 p-4 mb-4", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-green-400 font-semibold mb-2", children: "✅ Success!" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-green-200", children: "You have been promoted to admin. Redirecting to admin panel..." })
      ] }) }) : /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
        /* @__PURE__ */ jsxs("div", { className: "mb-6", children: [
          /* @__PURE__ */ jsx("p", { className: "text-lg mb-2", children: "Current User:" }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-center gap-3", children: [
            user.profile_image_url && /* @__PURE__ */ jsx("img", { src: user.profile_image_url, alt: user.display_name || user.username, className: "w-12 h-12 rounded-full" }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("div", { className: "font-semibold", children: user.display_name || user.username }),
              /* @__PURE__ */ jsxs("div", { className: "text-sm text-white/60", children: [
                "Role: ",
                user.role
              ] })
            ] })
          ] })
        ] }),
        error && /* @__PURE__ */ jsx("div", { className: "rounded-2xl border border-red-500/20 bg-red-500/10 p-4 mb-4", children: /* @__PURE__ */ jsx("p", { className: "text-red-400 text-sm", children: error }) }),
        /* @__PURE__ */ jsx("button", { onClick: handlePromoteToAdmin, disabled: promoting, className: "px-8 py-4 rounded-xl font-semibold text-black disabled:opacity-50", style: {
          background: "linear-gradient(90deg, #00f5ff, #b24bf3, #ff1493, #ffd700)"
        }, children: promoting ? "Promoting..." : "Promote Me to Admin" }),
        /* @__PURE__ */ jsxs("div", { className: "mt-6 text-sm text-white/60", children: [
          /* @__PURE__ */ jsx("p", { children: "After becoming admin, you can:" }),
          /* @__PURE__ */ jsxs("ul", { className: "list-disc list-inside mt-2 space-y-1", children: [
            /* @__PURE__ */ jsx("li", { children: "Generate unlimited AI images" }),
            /* @__PURE__ */ jsx("li", { children: "Manage other users" }),
            /* @__PURE__ */ jsx("li", { children: "View admin dashboard" }),
            /* @__PURE__ */ jsx("li", { children: "Promote other users to admin or streamer roles" })
          ] })
        ] })
      ] })
    ] })
  ] }) }) });
}
const page$8 = UNSAFE_withComponentProps(function WrappedPage3(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(PromoteFirstAdminPage, {
      ...props
    })
  });
});
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$8
}, Symbol.toStringTag, { value: "Module" }));
function AuthFinishPage() {
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(3);
  const bgStyle = useMemo(() => ({
    background: "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)"
  }), []);
  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);
    const next = url.searchParams.get("next") || "/dashboard";
    async function pollSessionAndRedirect() {
      try {
        const res = await fetch("/api/auth/me", {
          cache: "no-store"
        });
        if (!res.ok) throw new Error("Failed to verify session");
        const data = await res.json();
        if (data?.user) {
          window.location.replace(next);
          return;
        }
        setTimeout(pollSessionAndRedirect, 400);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setError(e.message || "Could not finish sign in");
      }
    }
    pollSessionAndRedirect();
    const timer = setInterval(() => {
      setCountdown((c) => c > 0 ? c - 1 : 0);
    }, 1e3);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white", style: {
    backgroundColor: "#0a0e27"
  }, children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: bgStyle }),
    /* @__PURE__ */ jsx("div", { className: "min-h-screen flex items-center justify-center px-6", children: /* @__PURE__ */ jsxs("div", { className: "max-w-md w-full text-center", children: [
      /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold", children: "You're back from Twitch" }),
      /* @__PURE__ */ jsx("p", { className: "mt-2 text-white/80", children: "Finishing sign-in…" }),
      /* @__PURE__ */ jsx("div", { className: "mt-6 flex items-center justify-center", children: /* @__PURE__ */ jsx("div", { className: "w-10 h-10 border-4 border-[#00f5ff] border-t-transparent rounded-full animate-spin" }) }),
      /* @__PURE__ */ jsxs("p", { className: "mt-4 text-sm text-white/60", children: [
        "This should take just a moment. Redirecting in ~",
        countdown,
        "s…"
      ] }),
      error && /* @__PURE__ */ jsx("div", { className: "mt-6 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm", children: error })
    ] }) })
  ] });
}
const page$7 = UNSAFE_withComponentProps(function WrappedPage4(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(AuthFinishPage, {
      ...props
    })
  });
});
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$7
}, Symbol.toStringTag, { value: "Module" }));
function TwitchAuthRedirectPage() {
  const [error, setError] = useState(null);
  const [authUrl, setAuthUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const res = await fetch("/api/auth/twitch?format=json", {
          cache: "no-store"
        });
        if (!res.ok) {
          throw new Error(`Auth init failed: [${res.status}] ${res.statusText}`);
        }
        const data = await res.json();
        if (!data?.url) {
          throw new Error("No auth URL returned");
        }
        if (cancelled) return;
        setAuthUrl(data.url);
        window.location.replace(data.url);
      } catch (e) {
        console.error(e);
        if (cancelled) return;
        setError(e.message || "Could not start Twitch sign in");
      }
    }
    go();
    return () => {
      cancelled = true;
    };
  }, []);
  return /* @__PURE__ */ jsx("div", { className: "min-h-screen flex items-center justify-center bg-[#0a0e27] px-6", children: /* @__PURE__ */ jsxs("div", { className: "max-w-md w-full text-center text-white", children: [
    /* @__PURE__ */ jsx("h1", { className: "text-2xl font-semibold", children: "Connecting to Twitch…" }),
    /* @__PURE__ */ jsx("p", { className: "mt-2 text-white/70", children: "Please wait while we redirect you to Twitch to sign in." }),
    /* @__PURE__ */ jsx("div", { className: "mt-6 flex items-center justify-center", children: /* @__PURE__ */ jsx("div", { className: "w-10 h-10 border-4 border-[#00f5ff] border-t-transparent rounded-full animate-spin" }) }),
    authUrl && /* @__PURE__ */ jsxs("p", { className: "mt-4 text-sm text-white/60", children: [
      "If you’re not redirected,",
      " ",
      /* @__PURE__ */ jsx("a", { href: authUrl, className: "text-[#00f5ff] underline", children: "click here" }),
      "."
    ] }),
    error && /* @__PURE__ */ jsx("div", { className: "mt-6 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm", children: error })
  ] }) });
}
const page$6 = UNSAFE_withComponentProps(function WrappedPage5(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(TwitchAuthRedirectPage, {
      ...props
    })
  });
});
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$6
}, Symbol.toStringTag, { value: "Module" }));
function BillingSuccessPage() {
  const [message, setMessage] = useState("Finishing your upgrade...");
  const bgStyle = useMemo(() => ({
    background: "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)"
  }), []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setMessage("Missing session. Redirecting to pricing...");
      const t = setTimeout(() => window.location.href = "/pricing", 1500);
      return () => clearTimeout(t);
    }
    window.location.href = `/api/billing/checkout-success?session_id=${encodeURIComponent(sessionId)}`;
  }, []);
  return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white flex items-center justify-center", style: {
    backgroundColor: "#0a0e27"
  }, children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: bgStyle }),
    /* @__PURE__ */ jsx("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-8 text-center", children: /* @__PURE__ */ jsx("div", { className: "animate-pulse", children: message }) })
  ] });
}
const page$5 = UNSAFE_withComponentProps(function WrappedPage6(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(BillingSuccessPage, {
      ...props
    })
  });
});
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$5
}, Symbol.toStringTag, { value: "Module" }));
function useUpload() {
  const [loading, setLoading] = React.useState(false);
  const upload = React.useCallback(async (input) => {
    try {
      setLoading(true);
      let response;
      if ("reactNativeAsset" in input && input.reactNativeAsset) {
        if (input.reactNativeAsset.file) {
          const formData = new FormData();
          formData.append("file", input.reactNativeAsset.file);
          response = await fetch("/api/upload", {
            method: "POST",
            body: formData
          });
        } else {
          const response2 = await fetch("/api/upload/presign", {
            method: "POST"
          });
          const {
            secureSignature,
            secureExpire
          } = await response2.json();
          const result = await client.uploadFile(input.reactNativeAsset, {
            fileName: input.reactNativeAsset.name ?? input.reactNativeAsset.uri.split("/").pop(),
            contentType: input.reactNativeAsset.mimeType,
            secureSignature,
            secureExpire
          });
          return {
            url: `${process.env.NEXT_PUBLIC_BASE_CREATE_USER_CONTENT_URL}/${result.uuid}/`,
            mimeType: result.mimeType || null
          };
        }
      } else if ("file" in input && input.file) {
        const formData = new FormData();
        formData.append("file", input.file);
        response = await fetch("/api/upload", {
          method: "POST",
          body: formData
        });
      } else if ("url" in input) {
        response = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            url: input.url
          })
        });
      } else if ("base64" in input) {
        response = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            base64: input.base64
          })
        });
      } else {
        response = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream"
          },
          body: input.buffer
        });
      }
      if (!response.ok) {
        if (response.status === 413) {
          throw new Error("Upload failed: File too large.");
        }
        throw new Error("Upload failed");
      }
      const data = await response.json();
      return {
        url: data.url,
        mimeType: data.mimeType || null
      };
    } catch (uploadError) {
      if (uploadError instanceof Error) {
        return {
          error: uploadError.message
        };
      }
      if (typeof uploadError === "string") {
        return {
          error: uploadError
        };
      }
      return {
        error: "Upload failed"
      };
    } finally {
      setLoading(false);
    }
  }, []);
  return [upload, {
    loading
  }];
}
function getClientId() {
  if (typeof window === "undefined") return null;
  let clientId = localStorage.getItem("cuhz_client_id");
  if (!clientId) {
    clientId = "client_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("cuhz_client_id", clientId);
  }
  return clientId;
}
function drawChain(ctx, width, height, options) {
  const {
    style,
    color,
    scale,
    offsetY
  } = options;
  const centerX = width / 2;
  const baseY = height * (0.65 + offsetY);
  const radius = Math.min(width, height) * 0.28 * scale;
  const ringCount = 18;
  const ringRadius = Math.max(3, Math.round(Math.min(width, height) * 0.014 * scale));
  let gradient2;
  if (style === "rainbow" || style === "iced") {
    gradient2 = ctx.createLinearGradient(0, baseY - radius, width, baseY + radius);
    gradient2.addColorStop(0, "#00f5ff");
    gradient2.addColorStop(0.33, "#b24bf3");
    gradient2.addColorStop(0.66, "#ff1493");
    gradient2.addColorStop(1, "#ffd700");
  }
  let stroke = "#ffd700";
  if (style === "silver") stroke = "#d1d5db";
  if (style === "custom") stroke = color || "#00f5ff";
  if (style === "rainbow" || style === "iced") stroke = gradient2;
  ctx.lineWidth = Math.max(2, ringRadius * 0.8);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    const angle = Math.PI * (0.15 + 0.7 * t);
    const x = centerX + radius * Math.cos(angle);
    const y = baseY + radius * Math.sin(angle) * 0.6;
    ctx.beginPath();
    ctx.strokeStyle = stroke;
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    if (style === "iced") {
      const sparkleCount = 2;
      for (let s = 0; s < sparkleCount; s++) {
        const sx = x + (Math.random() * 2 - 1) * ringRadius * 0.6;
        const sy = y + (Math.random() * 2 - 1) * ringRadius * 0.6;
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.arc(sx, sy, ringRadius * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const plateY = baseY - radius * 0.05;
  const plateWidth = radius * 1.1;
  const plateHeight = ringRadius * 2.6;
  const plateX = centerX - plateWidth / 2;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const r = plateHeight / 2;
  ctx.moveTo(plateX + r, plateY);
  ctx.lineTo(plateX + plateWidth - r, plateY);
  ctx.quadraticCurveTo(plateX + plateWidth, plateY, plateX + plateWidth, plateY + r);
  ctx.lineTo(plateX + plateWidth, plateY + plateHeight - r);
  ctx.quadraticCurveTo(plateX + plateWidth, plateY + plateHeight, plateX + plateWidth - r, plateY + plateHeight);
  ctx.lineTo(plateX + r, plateY + plateHeight);
  ctx.quadraticCurveTo(plateX, plateY + plateHeight, plateX, plateY + plateHeight - r);
  ctx.lineTo(plateX, plateY + r);
  ctx.quadraticCurveTo(plateX, plateY, plateX + r, plateY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.font = `${Math.max(14, Math.round(plateHeight * 0.95))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.fillText("CUHZ", centerX, plateY + plateHeight / 2);
}
function drawPlaceholder(ctx, width, height, options) {
  const {
    style,
    color,
    scale,
    offsetY
  } = options;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0a0e27");
  bg.addColorStop(0.5, "#141b44");
  bg.addColorStop(1, "#0a0e27");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const spot = ctx.createRadialGradient(width * 0.5, height * 0.35, 10, width * 0.5, height * 0.35, width * 0.7);
  spot.addColorStop(0, "rgba(178,75,243,0.25)");
  spot.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.ellipse(width / 2, height * 0.62, width * 0.22, height * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  drawChain(ctx, width, height, {
    style,
    color,
    scale,
    offsetY
  });
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "16px sans-serif";
  ctx.fillText("Pick a style • Upload a photo • Or generate with AI", width / 2, height * 0.9);
}
function useChainCanvas({
  sourceUrl,
  style,
  customColor,
  scale,
  offsetY,
  bgScale,
  bgOffsetX,
  bgOffsetY,
  pendingAutoSave,
  pendingAutoSaveStyle,
  user,
  saveUploadMutation,
  setPendingAutoSave,
  setPendingAutoSaveStyle,
  setError
}) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 640;
    const H = 640;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    if (!sourceUrl) {
      drawPlaceholder(ctx, W, H, {
        style,
        color: customColor,
        scale,
        offsetY
      });
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const imgRatio = img.width / img.height;
      const canvasRatio = W / H;
      let drawW;
      let drawH;
      let dx;
      let dy;
      if (imgRatio > canvasRatio) {
        drawH = H;
        drawW = img.width * (H / img.height);
      } else {
        drawW = W;
        drawH = img.height * (W / img.width);
      }
      const nextDrawW = drawW * bgScale;
      const nextDrawH = drawH * bgScale;
      const baseDx = (W - nextDrawW) / 2;
      const baseDy = (H - nextDrawH) / 2;
      dx = baseDx + bgOffsetX * W;
      dy = baseDy + bgOffsetY * H;
      ctx.drawImage(img, dx, dy, nextDrawW, nextDrawH);
      drawChain(ctx, W, H, {
        style,
        color: customColor,
        scale,
        offsetY
      });
      const canAutoSave = Boolean(user);
      const shouldAutoSave = Boolean(pendingAutoSave) && canAutoSave;
      if (shouldAutoSave) {
        const saveStyle = pendingAutoSaveStyle || style;
        setPendingAutoSave(false);
        setPendingAutoSaveStyle(null);
        try {
          const dataUrl = canvas.toDataURL("image/png");
          saveUploadMutation.mutate({
            dataUrl,
            chainStyle: saveStyle
          });
        } catch (e) {
          console.error(e);
        }
      }
    };
    img.onerror = () => {
      setError("Could not load image. Try another file.");
    };
    img.src = sourceUrl;
    imgRef.current = img;
  }, [sourceUrl, style, customColor, scale, offsetY, bgScale, bgOffsetX, bgOffsetY, pendingAutoSave, pendingAutoSaveStyle, user, saveUploadMutation, setPendingAutoSave, setPendingAutoSaveStyle, setError]);
  return {
    canvasRef,
    imgRef
  };
}
function useCanvasDrag({
  sourceUrl,
  bgOffsetX,
  bgOffsetY,
  setBgOffsetX,
  setBgOffsetY,
  canvasRef
}) {
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0
  });
  const clamp = useCallback((v, min, max) => {
    return Math.min(max, Math.max(min, v));
  }, []);
  const onCanvasPointerDown = useCallback((e) => {
    if (!sourceUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    dragRef.current.isDragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.startOffsetX = bgOffsetX;
    dragRef.current.startOffsetY = bgOffsetY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) {
    }
  }, [sourceUrl, bgOffsetX, bgOffsetY, canvasRef]);
  const onCanvasPointerMove = useCallback((e) => {
    if (!sourceUrl) return;
    if (!dragRef.current.isDragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const dxNorm = rect.width ? dx / rect.width : 0;
    const dyNorm = rect.height ? dy / rect.height : 0;
    const nextX = clamp(dragRef.current.startOffsetX + dxNorm, -0.35, 0.35);
    const nextY = clamp(dragRef.current.startOffsetY + dyNorm, -0.35, 0.35);
    setBgOffsetX(nextX);
    setBgOffsetY(nextY);
  }, [sourceUrl, clamp, canvasRef, setBgOffsetX, setBgOffsetY]);
  const onCanvasPointerUp = useCallback((e) => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {
      }
    }
    dragRef.current.isDragging = false;
  }, [canvasRef]);
  const onCanvasPointerCancel = useCallback(() => {
    dragRef.current.isDragging = false;
  }, []);
  return {
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel
  };
}
function useUsageQuery({
  user,
  clientId,
  authLoading
}) {
  const {
    data: usage,
    isLoading: usageLoading,
    error: usageError,
    refetch: refetchUsage
  } = useQuery({
    queryKey: ["ai-usage", user?.id || null, clientId || null],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (!user && clientId) params.set("clientId", clientId);
      const url = params.toString() ? `/api/chain/usage?${params.toString()}` : "/api/chain/usage";
      const res = await fetch(url, {
        cache: "no-store"
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data?.error || `When fetching ${url}, the response was [${res.status}] ${res.statusText}`;
        throw new Error(msg);
      }
      return res.json();
    },
    enabled: typeof window !== "undefined" && (Boolean(user) || Boolean(clientId)),
    retry: 1
  });
  useEffect(() => {
    if (usageError) {
      console.error(usageError);
    }
  }, [usageError]);
  const usageLine = useMemo(() => {
    if (authLoading || usageLoading) return null;
    if (!usage?.ok) return null;
    if (usage.isUnlimited) {
      return "Unlimited generations";
    }
    const used = Number(usage.todayCount || 0);
    const limit = Number(usage.dailyLimit || 10);
    const remaining = Number.isFinite(usage.remaining) ? usage.remaining : Math.max(0, limit - used);
    return `${used}/${limit} used today • ${remaining} left`;
  }, [authLoading, usageLoading, usage]);
  return {
    usage,
    usageLoading,
    usageError,
    refetchUsage,
    usageLine
  };
}
function useGenerateAI({
  clientId,
  refetchUsage
}) {
  const generateAIMutation = useMutation({
    mutationFn: async ({
      prompt,
      chainStyle
    }) => {
      const response = await fetch("/api/chain/generate-ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt,
          style: chainStyle,
          clientId
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.error || `When fetching /api/chain/generate-ai, the response was [${response.status}] ${response.statusText}`;
        throw new Error(msg);
      }
      return response.json();
    },
    onSuccess: () => {
      refetchUsage();
    }
  });
  return generateAIMutation;
}
function useSaveUpload({
  setLastSavedUrl
}) {
  const saveUploadMutation = useMutation({
    mutationFn: async ({
      dataUrl,
      chainStyle
    }) => {
      const clientId = getClientId();
      const response = await fetch("/api/chain/save-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image: dataUrl,
          style: chainStyle,
          clientId
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg = errorData.error || `When fetching /api/chain/save-upload, the response was [${response.status}] ${response.statusText}`;
        throw new Error(msg);
      }
      return response.json();
    },
    onSuccess: (data) => {
      setLastSavedUrl(data?.imageUrl || null);
      toast.success("Saved to your gallery");
    },
    onError: (err) => {
      console.error(err);
      toast.error(typeof err?.message === "string" ? err.message : "Could not save image");
    }
  });
  return saveUploadMutation;
}
function Header({
  authLoading,
  user,
  logout
}) {
  return /* @__PURE__ */ jsx("header", { className: "w-full border-b border-white/10", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between py-4", children: [
    /* @__PURE__ */ jsxs("a", { href: "/", className: "flex items-center gap-3", children: [
      /* @__PURE__ */ jsx("img", { src: "https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/", alt: "Planet Cuhz logo", className: "h-10 w-auto rounded-sm shadow-[0_0_20px_rgba(178,75,243,0.4)]" }),
      /* @__PURE__ */ jsxs("span", { className: "text-lg font-semibold tracking-wide", children: [
        "PLANET",
        " ",
        /* @__PURE__ */ jsx("span", { className: "text-transparent bg-clip-text bg-gradient-to-r from-[#00f5ff] via-[#b24bf3] to-[#ff1493]", children: "CUHZ" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("nav", { className: "hidden md:flex items-center gap-6 text-sm opacity-90", children: [
      /* @__PURE__ */ jsx("a", { href: "/", className: "hover:opacity-100", children: "Home" }),
      /* @__PURE__ */ jsx("a", { href: "/chain-generator", className: "text-white font-semibold hover:opacity-100", children: "Generator" }),
      /* @__PURE__ */ jsx("a", { href: "/gallery", className: "hover:opacity-100", children: "Gallery" }),
      /* @__PURE__ */ jsx("a", { href: "/cuhz-bot", className: "hover:opacity-100", children: "CuhzBot" }),
      /* @__PURE__ */ jsx("a", { href: "/pricing", className: "hover:opacity-100", children: "Pricing" })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "flex items-center gap-3", children: authLoading ? /* @__PURE__ */ jsx("div", { className: "px-4 py-2 rounded-xl border border-white/15 text-sm backdrop-blur-sm bg-white/5", children: "Loading..." }) : user ? /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        user.profile_image_url && /* @__PURE__ */ jsx("img", { src: user.profile_image_url, alt: user.display_name || user.username, className: "w-8 h-8 rounded-full ring-2 ring-[#b24bf3]/40" }),
        /* @__PURE__ */ jsxs("span", { className: "text-sm hidden sm:inline", children: [
          user.display_name || user.username,
          user.role === "admin" && /* @__PURE__ */ jsx("span", { className: "ml-1 text-xs bg-gradient-to-r from-[#00f5ff] to-[#b24bf3] text-black px-2 py-0.5 rounded-full font-semibold", children: "ADMIN" }),
          user.plan === "pro" && /* @__PURE__ */ jsx("span", { className: "ml-1 text-xs bg-[#ffd700] text-black px-2 py-0.5 rounded-full font-semibold", children: "PRO" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("button", { onClick: logout, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm backdrop-blur-sm bg-white/5", children: "Logout" })
    ] }) : /* @__PURE__ */ jsx("button", { onClick: startTwitchLogin, className: "px-4 py-2 rounded-xl font-semibold text-black text-sm", style: {
      background: "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493)"
    }, children: "Login with Twitch" }) })
  ] }) });
}
function UserStatusBanner({
  authLoading,
  user,
  usageLine
}) {
  if (authLoading) return null;
  const usageContent = usageLine || (user?.role === "admin" ? "Unlimited generations" : "10 AI generations per day");
  if (user) {
    return /* @__PURE__ */ jsxs("div", { className: "mt-4 rounded-2xl border border-[#b24bf3]/30 backdrop-blur-md p-4 flex items-center gap-3", style: {
      background: "rgba(178,75,243,0.08)"
    }, children: [
      /* @__PURE__ */ jsx("div", { className: "flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-[#00f5ff] to-[#b24bf3]", children: /* @__PURE__ */ jsx(Zap, { size: 16, className: "text-black" }) }),
      /* @__PURE__ */ jsxs("div", { className: "text-sm text-white/90", children: [
        "Welcome back,",
        " ",
        /* @__PURE__ */ jsx("span", { className: "font-bold text-white", children: user.display_name || user.username }),
        /* @__PURE__ */ jsx("span", { className: "ml-2 text-white/60", children: "•" }),
        /* @__PURE__ */ jsx("span", { className: "ml-2 text-[#00f5ff]", children: usageContent })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { className: "mt-4 rounded-2xl border border-white/10 backdrop-blur-md p-4 flex items-center gap-3", style: {
    background: "rgba(15,23,42,0.8)"
  }, children: [
    /* @__PURE__ */ jsx("div", { className: "flex items-center justify-center w-8 h-8 rounded-full bg-white/10", children: /* @__PURE__ */ jsx(User, { size: 16, className: "text-white/60" }) }),
    /* @__PURE__ */ jsxs("div", { className: "text-sm text-white/80", children: [
      "Anonymous mode",
      /* @__PURE__ */ jsx("span", { className: "ml-2 text-white/60", children: "•" }),
      /* @__PURE__ */ jsx("span", { className: "ml-2 text-white/60", children: usageContent }),
      /* @__PURE__ */ jsx("span", { className: "ml-2 text-white/60", children: "•" }),
      /* @__PURE__ */ jsx("a", { href: "/auth/twitch", className: "ml-2 text-transparent bg-clip-text bg-gradient-to-r from-[#00f5ff] to-[#b24bf3] font-semibold hover:underline", children: "Sign in with Twitch" }),
      " ",
      "to save creations"
    ] })
  ] });
}
function ImageUploadSection({
  handleFileChange,
  uploading
}) {
  const inputRef = useRef(null);
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("input", { ref: inputRef, type: "file", accept: "image/*", onChange: handleFileChange, className: "hidden" }),
    /* @__PURE__ */ jsx("button", { type: "button", onClick: () => inputRef.current?.click(), disabled: uploading, className: "w-full group relative rounded-2xl border-2 border-dashed border-white/15 hover:border-[#00f5ff]/50 transition-all duration-300 p-6 flex flex-col items-center justify-center gap-3 backdrop-blur-sm cursor-pointer", style: {
      background: "rgba(15,23,42,0.6)"
    }, children: uploading ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Loader2, { size: 28, className: "text-[#00f5ff] animate-spin" }),
      /* @__PURE__ */ jsx("span", { className: "text-sm text-white/70", children: "Uploading…" })
    ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("div", { className: "w-12 h-12 rounded-xl bg-gradient-to-br from-[#00f5ff]/20 to-[#b24bf3]/20 flex items-center justify-center group-hover:from-[#00f5ff]/30 group-hover:to-[#b24bf3]/30 transition-all", children: /* @__PURE__ */ jsx(Upload, { size: 22, className: "text-[#00f5ff]" }) }),
      /* @__PURE__ */ jsx("span", { className: "text-sm font-medium text-white/80 group-hover:text-white transition-colors", children: "Upload Photo" }),
      /* @__PURE__ */ jsx("span", { className: "text-xs text-white/40", children: "Click or drop an image" })
    ] }) })
  ] });
}
function AIGenerationForm({
  handleGenerateAI,
  isGenerating,
  autoSaveToGallery,
  setAutoSaveToGallery,
  autoSaveAfterUpload,
  setAutoSaveAfterUpload,
  canAutoSave
}) {
  const autoSaveLabel = canAutoSave ? "Auto-save AI to Gallery" : "Auto-save (sign in)";
  const autoSaveUploadLabel = canAutoSave ? "Auto-save uploads" : "Auto-save uploads (sign in)";
  return /* @__PURE__ */ jsxs("form", { onSubmit: handleGenerateAI, className: "block", children: [
    /* @__PURE__ */ jsx("div", { className: "relative", children: /* @__PURE__ */ jsx("textarea", { name: "prompt", rows: 3, placeholder: "a cool cat wearing sunglasses in space...", className: "w-full rounded-2xl border border-white/10 focus:border-[#b24bf3]/50 backdrop-blur-sm p-4 text-sm text-white placeholder-white/30 focus:outline-none transition-colors resize-none", style: {
      background: "rgba(15,23,42,0.6)"
    } }) }),
    /* @__PURE__ */ jsx("button", { type: "submit", disabled: isGenerating, className: "mt-3 w-full px-5 py-3 rounded-2xl font-bold text-black disabled:opacity-50 transition-all duration-300 relative overflow-hidden group", style: {
      background: "linear-gradient(135deg,#00f5ff,#b24bf3 50%,#ff1493)",
      boxShadow: "0 0 30px rgba(178,75,243,0.3)"
    }, children: /* @__PURE__ */ jsx("span", { className: "relative z-10 flex items-center justify-center gap-2", children: isGenerating ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Loader2, { size: 18, style: {
        animation: "cuhzSpin 1s linear infinite"
      } }),
      "Generating…"
    ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(Sparkles, { size: 18 }),
      "Generate with AI"
    ] }) }) }),
    /* @__PURE__ */ jsxs("div", { className: "mt-3 flex flex-col gap-2", children: [
      /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2 text-xs text-white/60 cursor-pointer hover:text-white/80 transition-colors", children: [
        /* @__PURE__ */ jsx("input", { type: "checkbox", checked: autoSaveToGallery, onChange: (e) => setAutoSaveToGallery(e.target.checked), disabled: !canAutoSave, className: "accent-[#b24bf3] w-3.5 h-3.5" }),
        autoSaveLabel
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2 text-xs text-white/60 cursor-pointer hover:text-white/80 transition-colors", children: [
        /* @__PURE__ */ jsx("input", { type: "checkbox", checked: autoSaveAfterUpload, onChange: (e) => setAutoSaveAfterUpload(e.target.checked), disabled: !canAutoSave, className: "accent-[#b24bf3] w-3.5 h-3.5" }),
        autoSaveUploadLabel
      ] })
    ] })
  ] });
}
function StyleSelector({
  style,
  setStyle,
  customColor,
  setCustomColor
}) {
  const styleOptions = [{
    id: "rainbow",
    label: "Rainbow",
    tag: "OG",
    gradient: "linear-gradient(135deg,#00f5ff,#b24bf3,#ff1493,#ffd700)",
    borderActive: "#b24bf3"
  }, {
    id: "gold",
    label: "Gold",
    tag: null,
    gradient: "linear-gradient(135deg,#ffd700,#f59e0b,#fbbf24)",
    borderActive: "#ffd700"
  }, {
    id: "silver",
    label: "Silver",
    tag: null,
    gradient: "linear-gradient(135deg,#d1d5db,#9ca3af,#e5e7eb)",
    borderActive: "#d1d5db"
  }, {
    id: "iced",
    label: "Iced Out",
    tag: "✨",
    gradient: "linear-gradient(135deg,#00f5ff,#818cf8,#c084fc)",
    borderActive: "#00f5ff"
  }, {
    id: "custom",
    label: "Custom",
    tag: null,
    gradient: null,
    borderActive: customColor
  }];
  return /* @__PURE__ */ jsxs("div", { className: "mt-8", children: [
    /* @__PURE__ */ jsx("h3", { className: "text-lg font-bold text-white", children: "Chain Style" }),
    /* @__PURE__ */ jsx("p", { className: "text-xs text-white/40 mt-1", children: "Pick your vibe" }),
    /* @__PURE__ */ jsx("div", { className: "mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3", children: styleOptions.map((opt) => {
      const isActive = style === opt.id;
      const previewBg = opt.gradient || `linear-gradient(135deg,${customColor},${customColor}88)`;
      return /* @__PURE__ */ jsx("button", { onClick: () => setStyle(opt.id), className: "relative rounded-2xl p-[1px] transition-all duration-300 group", style: {
        background: isActive ? opt.borderActive : "rgba(255,255,255,0.08)",
        boxShadow: isActive ? `0 0 20px ${opt.borderActive}40` : "none"
      }, children: /* @__PURE__ */ jsxs("div", { className: "rounded-2xl px-3 py-3 flex flex-col items-center gap-2 backdrop-blur-sm transition-all", style: {
        background: "rgba(10,14,39,0.9)"
      }, children: [
        /* @__PURE__ */ jsx("div", { className: "w-8 h-8 rounded-full", style: {
          background: previewBg
        } }),
        /* @__PURE__ */ jsx("span", { className: "text-xs font-medium text-white/90", children: opt.label }),
        opt.tag && /* @__PURE__ */ jsx("span", { className: "absolute -top-1 -right-1 text-[10px] bg-[#b24bf3] text-white px-1.5 py-0.5 rounded-full font-bold", children: opt.tag })
      ] }) }, opt.id);
    }) }),
    style === "custom" && /* @__PURE__ */ jsxs("div", { className: "mt-5 rounded-2xl border border-white/10 backdrop-blur-md p-5", style: {
      background: "rgba(15,23,42,0.6)"
    }, children: [
      /* @__PURE__ */ jsx("div", { className: "text-sm text-white/80 mb-3 font-medium", children: "Pick your color" }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-start gap-5", children: [
        /* @__PURE__ */ jsx(HexColorPicker, { color: customColor, onChange: setCustomColor }),
        /* @__PURE__ */ jsxs("div", { className: "text-sm text-white/80 flex flex-col gap-3", children: [
          /* @__PURE__ */ jsx("div", { className: "w-16 h-16 rounded-xl border border-white/10", style: {
            background: customColor
          } }),
          /* @__PURE__ */ jsx("input", { value: customColor, onChange: (e) => setCustomColor(e.target.value), className: "w-[140px] rounded-xl border border-white/10 backdrop-blur-sm px-3 py-2 text-sm focus:outline-none focus:border-[#b24bf3]/50 transition-colors", style: {
            background: "rgba(15,23,42,0.6)"
          } })
        ] })
      ] })
    ] })
  ] });
}
function ChainControls({
  scale,
  setScale,
  offsetY,
  setOffsetY
}) {
  return /* @__PURE__ */ jsxs("div", { className: "mt-6", children: [
    /* @__PURE__ */ jsx("h3", { className: "text-lg font-bold text-white", children: "Adjustments" }),
    /* @__PURE__ */ jsx("p", { className: "text-xs text-white/40 mt-1", children: "Fine-tune the chain overlay" }),
    /* @__PURE__ */ jsxs("div", { className: "mt-4 grid grid-cols-1 md:grid-cols-2 gap-5", children: [
      /* @__PURE__ */ jsxs("label", { className: "block", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-3", children: [
          /* @__PURE__ */ jsx(Maximize2, { size: 14, className: "text-[#00f5ff]" }),
          /* @__PURE__ */ jsx("span", { className: "text-sm font-medium text-white/80", children: "Chain Size" }),
          /* @__PURE__ */ jsxs("span", { className: "ml-auto text-xs text-white/40", children: [
            Math.round(scale * 100),
            "%"
          ] })
        ] }),
        /* @__PURE__ */ jsx("input", { type: "range", min: "0.8", max: "1.25", step: "0.01", value: scale, onChange: (e) => setScale(parseFloat(e.target.value)), className: "w-full accent-[#b24bf3]" })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "block", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-3", children: [
          /* @__PURE__ */ jsx(ArrowUpDown, { size: 14, className: "text-[#00f5ff]" }),
          /* @__PURE__ */ jsx("span", { className: "text-sm font-medium text-white/80", children: "Vertical Position" }),
          /* @__PURE__ */ jsxs("span", { className: "ml-auto text-xs text-white/40", children: [
            offsetY > 0 ? "+" : "",
            Math.round(offsetY * 100)
          ] })
        ] }),
        /* @__PURE__ */ jsx("input", { type: "range", min: "-0.12", max: "0.12", step: "0.005", value: offsetY, onChange: (e) => setOffsetY(parseFloat(e.target.value)), className: "w-full accent-[#b24bf3]" })
      ] })
    ] })
  ] });
}
function BackgroundPositionControls({
  sourceUrl,
  bgScale,
  setBgScale,
  bgOffsetX,
  setBgOffsetX,
  bgOffsetY,
  setBgOffsetY,
  resetPosition
}) {
  if (!sourceUrl) return null;
  return /* @__PURE__ */ jsxs("div", { className: "mt-6 rounded-2xl border border-white/10 backdrop-blur-md p-5", style: {
    background: "rgba(15,23,42,0.6)"
  }, children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-3", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { className: "text-sm font-bold text-white", children: "Background Position" }),
        /* @__PURE__ */ jsx("div", { className: "text-xs text-white/40 mt-1", children: "Zoom and move the photo so the chain sits right" })
      ] }),
      /* @__PURE__ */ jsxs("button", { type: "button", onClick: resetPosition, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-white/70 hover:text-white transition-colors border border-white/10 hover:border-white/25 backdrop-blur-sm", style: {
        background: "rgba(15,23,42,0.6)"
      }, children: [
        /* @__PURE__ */ jsx(RotateCcw, { size: 12 }),
        "Reset"
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-5 grid grid-cols-1 md:grid-cols-3 gap-5", children: [
      /* @__PURE__ */ jsxs("label", { className: "block", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-3", children: [
          /* @__PURE__ */ jsx(ZoomIn, { size: 12, className: "text-[#00f5ff]" }),
          /* @__PURE__ */ jsx("span", { className: "text-xs font-medium text-white/70", children: "Zoom" }),
          /* @__PURE__ */ jsxs("span", { className: "ml-auto text-xs text-white/40", children: [
            Math.round(bgScale * 100),
            "%"
          ] })
        ] }),
        /* @__PURE__ */ jsx("input", { type: "range", min: "0.9", max: "1.6", step: "0.01", value: bgScale, onChange: (e) => setBgScale(parseFloat(e.target.value)), className: "w-full accent-[#00f5ff]" })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "block", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-3", children: [
          /* @__PURE__ */ jsx(MoveHorizontal, { size: 12, className: "text-[#00f5ff]" }),
          /* @__PURE__ */ jsx("span", { className: "text-xs font-medium text-white/70", children: "Left / Right" }),
          /* @__PURE__ */ jsxs("span", { className: "ml-auto text-xs text-white/40", children: [
            bgOffsetX > 0 ? "+" : "",
            Math.round(bgOffsetX * 100)
          ] })
        ] }),
        /* @__PURE__ */ jsx("input", { type: "range", min: "-0.35", max: "0.35", step: "0.01", value: bgOffsetX, onChange: (e) => setBgOffsetX(parseFloat(e.target.value)), className: "w-full accent-[#00f5ff]" })
      ] }),
      /* @__PURE__ */ jsxs("label", { className: "block", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-3", children: [
          /* @__PURE__ */ jsx(MoveVertical, { size: 12, className: "text-[#00f5ff]" }),
          /* @__PURE__ */ jsx("span", { className: "text-xs font-medium text-white/70", children: "Up / Down" }),
          /* @__PURE__ */ jsxs("span", { className: "ml-auto text-xs text-white/40", children: [
            bgOffsetY > 0 ? "+" : "",
            Math.round(bgOffsetY * 100)
          ] })
        ] }),
        /* @__PURE__ */ jsx("input", { type: "range", min: "-0.35", max: "0.35", step: "0.01", value: bgOffsetY, onChange: (e) => setBgOffsetY(parseFloat(e.target.value)), className: "w-full accent-[#00f5ff]" })
      ] })
    ] })
  ] });
}
const DISCORD_INVITE = "https://discord.gg/eNxDKkxQdN";
function ActionButtons({
  sourceUrl,
  handleDownload,
  handleSaveToGallery,
  isSaving,
  error,
  lastSavedUrl
}) {
  return /* @__PURE__ */ jsxs("div", { className: "mt-6", children: [
    error && /* @__PURE__ */ jsxs("div", { className: "mb-4 rounded-2xl border border-red-500/30 p-4 flex items-center gap-3", style: {
      background: "rgba(239,68,68,0.08)"
    }, children: [
      /* @__PURE__ */ jsx(AlertCircle, { size: 16, className: "text-red-400 shrink-0" }),
      /* @__PURE__ */ jsx("span", { className: "text-sm text-red-300", children: error })
    ] }),
    lastSavedUrl && /* @__PURE__ */ jsxs("div", { className: "mb-4 rounded-2xl border border-[#00f5ff]/30 p-4 flex items-center gap-3", style: {
      background: "rgba(0,245,255,0.05)"
    }, children: [
      /* @__PURE__ */ jsx(Save, { size: 16, className: "text-[#00f5ff] shrink-0" }),
      /* @__PURE__ */ jsxs("span", { className: "text-sm text-white/80", children: [
        "Saved!",
        " ",
        /* @__PURE__ */ jsx("a", { href: "/gallery", className: "text-[#00f5ff] hover:underline font-medium", children: "View in Gallery" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex flex-col sm:flex-row gap-3", children: [
      /* @__PURE__ */ jsxs("button", { onClick: handleDownload, disabled: !sourceUrl, className: "flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl font-bold text-black disabled:opacity-40 transition-all duration-300", style: {
        background: sourceUrl ? "linear-gradient(135deg,#00f5ff,#b24bf3 50%,#ff1493)" : "rgba(255,255,255,0.1)",
        boxShadow: sourceUrl ? "0 0 30px rgba(178,75,243,0.3)" : "none",
        color: sourceUrl ? "black" : "rgba(255,255,255,0.3)"
      }, children: [
        /* @__PURE__ */ jsx(Download, { size: 18 }),
        "Download"
      ] }),
      /* @__PURE__ */ jsxs("button", { onClick: handleSaveToGallery, disabled: !sourceUrl || isSaving, className: "flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl font-bold border border-white/15 hover:border-[#b24bf3]/50 text-white disabled:opacity-40 transition-all duration-300 backdrop-blur-sm", style: {
        background: "rgba(15,23,42,0.6)"
      }, children: [
        /* @__PURE__ */ jsx(Save, { size: 18 }),
        isSaving ? "Saving…" : "Save to Gallery"
      ] }),
      /* @__PURE__ */ jsxs("a", { href: DISCORD_INVITE, target: "_blank", rel: "noreferrer", className: "flex-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl font-bold border border-white/15 hover:border-[#00f5ff]/50 text-white transition-all duration-300 backdrop-blur-sm", style: {
        background: "rgba(15,23,42,0.6)"
      }, children: [
        /* @__PURE__ */ jsx(MessageCircle, { size: 18 }),
        "Discord",
        /* @__PURE__ */ jsx(ExternalLink, { size: 12, className: "text-white/40" })
      ] })
    ] })
  ] });
}
function CanvasPreview({
  canvasRef,
  sourceUrl,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasPointerCancel
}) {
  return /* @__PURE__ */ jsxs("div", { className: "relative", children: [
    /* @__PURE__ */ jsx("div", { className: "absolute -inset-4 rounded-3xl blur-2xl opacity-40 -z-10", style: {
      background: "conic-gradient(from 180deg, #00f5ff, #b24bf3, #ff1493, #00f5ff)"
    } }),
    /* @__PURE__ */ jsxs("div", { className: "rounded-3xl border border-white/10 backdrop-blur-md overflow-hidden", style: {
      background: "rgba(15,23,42,0.8)"
    }, children: [
      /* @__PURE__ */ jsxs("div", { className: "px-5 py-4 border-b border-white/10 flex items-center justify-between", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-lg font-bold text-white", children: "Preview" }),
        sourceUrl && /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5 text-xs text-white/40", children: [
          /* @__PURE__ */ jsx(Move, { size: 12 }),
          "Drag to reposition"
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "p-4", children: /* @__PURE__ */ jsx("canvas", { ref: canvasRef, onPointerDown: onCanvasPointerDown, onPointerMove: onCanvasPointerMove, onPointerUp: onCanvasPointerUp, onPointerCancel: onCanvasPointerCancel, className: "w-full h-auto rounded-2xl", style: sourceUrl ? {
        touchAction: "none",
        cursor: "grab"
      } : void 0 }) }),
      /* @__PURE__ */ jsx("div", { className: "px-5 pb-4", children: /* @__PURE__ */ jsx("div", { className: "rounded-xl p-3 text-center text-xs text-white/50", style: {
        background: "rgba(255,255,255,0.03)"
      }, children: sourceUrl ? "💡 Drag the photo to reposition, use sliders to zoom" : "🎨 Upload a photo or generate with AI to get started" }) })
    ] })
  ] });
}
function ChainGeneratorPage() {
  const {
    user,
    loading: authLoading,
    logout
  } = useTwitchAuth();
  const [sourceUrl, setSourceUrl] = useState(null);
  const [style, setStyle] = useState("rainbow");
  const [customColor, setCustomColor] = useState("#00f5ff");
  const [scale, setScale] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [error, setError] = useState(null);
  const [upload, {
    loading: uploading
  }] = useUpload();
  const [activeTab, setActiveTab] = useState("upload");
  const [clientId, setClientId] = useState(null);
  const [bgScale, setBgScale] = useState(1);
  const [bgOffsetX, setBgOffsetX] = useState(0);
  const [bgOffsetY, setBgOffsetY] = useState(0);
  const [autoSaveToGallery, setAutoSaveToGallery] = useState(false);
  const [pendingAutoSave, setPendingAutoSave] = useState(false);
  const [pendingAutoSaveStyle, setPendingAutoSaveStyle] = useState(null);
  const [lastSavedUrl, setLastSavedUrl] = useState(null);
  const [autoSaveAfterUpload, setAutoSaveAfterUpload] = useState(false);
  const bgStyle = useMemo(() => ({
    background: "radial-gradient(ellipse 1200px 800px at 20% -10%, rgba(178,75,243,0.18), transparent), radial-gradient(ellipse 1000px 700px at 80% 0%, rgba(0,245,255,0.14), transparent), radial-gradient(ellipse 1200px 600px at 50% 100%, rgba(255,20,147,0.12), transparent)"
  }), []);
  useEffect(() => {
    setClientId(getClientId());
  }, []);
  useEffect(() => {
    if (user) {
      setAutoSaveToGallery(true);
    }
  }, [user]);
  const {
    usageLine,
    refetchUsage
  } = useUsageQuery({
    user,
    clientId,
    authLoading
  });
  const generateAIMutation = useGenerateAI({
    clientId,
    refetchUsage
  });
  const saveUploadMutation = useSaveUpload({
    setLastSavedUrl
  });
  const resetPosition = useCallback(() => {
    setBgScale(1);
    setBgOffsetX(0);
    setBgOffsetY(0);
  }, []);
  const handleFileChange = async (e) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const {
      url,
      error: uploadError
    } = await upload({
      file
    });
    if (uploadError) {
      console.error(uploadError);
      setError(uploadError);
      return;
    }
    setSourceUrl(url);
    resetPosition();
    setLastSavedUrl(null);
    const shouldAutoSaveUpload = Boolean(autoSaveAfterUpload) && Boolean(user);
    if (shouldAutoSaveUpload) {
      setPendingAutoSave(true);
      setPendingAutoSaveStyle(style);
    }
  };
  const handleGenerateAI = async (e) => {
    e.preventDefault();
    setError(null);
    setLastSavedUrl(null);
    const rawPrompt = new FormData(e.currentTarget).get("prompt");
    const promptText = String(rawPrompt || "").trim();
    if (!promptText) {
      setError("Please enter a prompt.");
      return;
    }
    const promptFinal = `${promptText}, realistic, high quality`;
    try {
      const styleAtRequest = style;
      const data = await generateAIMutation.mutateAsync({
        prompt: promptFinal,
        chainStyle: styleAtRequest
      });
      if (data?.imageUrl) {
        setSourceUrl(data.imageUrl);
        resetPosition();
        const canAutoSave2 = Boolean(user);
        const shouldAutoSave = Boolean(autoSaveToGallery) && canAutoSave2;
        if (shouldAutoSave) {
          setPendingAutoSave(true);
          setPendingAutoSaveStyle(styleAtRequest);
        }
      } else {
        setError("AI generation did not return an image. Please try again.");
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "AI generation failed. Please try again.");
    }
  };
  const {
    canvasRef
  } = useChainCanvas({
    sourceUrl,
    style,
    customColor,
    scale,
    offsetY,
    bgScale,
    bgOffsetX,
    bgOffsetY,
    pendingAutoSave,
    pendingAutoSaveStyle,
    user,
    saveUploadMutation,
    setPendingAutoSave,
    setPendingAutoSaveStyle,
    setError
  });
  const {
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel
  } = useCanvasDrag({
    sourceUrl,
    bgOffsetX,
    bgOffsetY,
    setBgOffsetX,
    setBgOffsetY,
    canvasRef
  });
  const canAutoSave = Boolean(user);
  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const data = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = data;
    a.download = "cuhz-chain.png";
    a.click();
  }, [canvasRef]);
  const handleSaveToGallery = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      saveUploadMutation.mutate({
        dataUrl,
        chainStyle: style
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not prepare image to save");
    }
  }, [canvasRef, saveUploadMutation, style]);
  const isUploadTab = activeTab === "upload";
  const isAiTab = activeTab === "ai";
  return /* @__PURE__ */ jsxs("div", { style: {
    backgroundColor: "#0b1121"
  }, className: "jsx-945736273 min-h-screen text-white relative", children: [
    /* @__PURE__ */ jsx("div", { style: bgStyle, className: "jsx-945736273 fixed inset-0 -z-10" }),
    /* @__PURE__ */ jsxs("div", { className: "jsx-945736273 max-w-[1300px] mx-auto px-4 sm:px-6 pb-12", children: [
      /* @__PURE__ */ jsx(Header, { authLoading, user, logout }),
      /* @__PURE__ */ jsxs("div", { className: "jsx-945736273 mt-8 text-center", children: [
        /* @__PURE__ */ jsxs("h1", { className: "jsx-945736273 text-3xl md:text-4xl font-extrabold", children: [
          "Chain",
          " ",
          /* @__PURE__ */ jsx("span", { className: "jsx-945736273 text-transparent bg-clip-text bg-gradient-to-r from-[#00f5ff] via-[#b24bf3] to-[#ff1493]", children: "Generator" })
        ] }),
        /* @__PURE__ */ jsx("p", { className: "jsx-945736273 mt-2 text-sm text-white/50 max-w-md mx-auto", children: "Upload or create with AI, add your signature chain, and download your masterpiece" })
      ] }),
      /* @__PURE__ */ jsx(UserStatusBanner, { authLoading, user, usageLine }),
      /* @__PURE__ */ jsxs("div", { className: "jsx-945736273 mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start", children: [
        /* @__PURE__ */ jsxs("div", { style: {
          background: "rgba(15,23,42,0.8)"
        }, className: "jsx-945736273 rounded-3xl border border-white/10 backdrop-blur-md overflow-hidden", children: [
          /* @__PURE__ */ jsxs("div", { className: "jsx-945736273 p-6 pb-0", children: [
            /* @__PURE__ */ jsx("h2", { className: "jsx-945736273 text-xl font-bold text-white", children: "Get an Image" }),
            /* @__PURE__ */ jsxs("div", { style: {
              background: "rgba(255,255,255,0.05)"
            }, className: "jsx-945736273 mt-4 flex rounded-2xl p-1 gap-1", children: [
              /* @__PURE__ */ jsx("button", { onClick: () => setActiveTab("upload"), style: {
                background: isUploadTab ? "linear-gradient(135deg,#00f5ff,#b24bf3)" : "transparent",
                color: isUploadTab ? "black" : "rgba(255,255,255,0.5)"
              }, className: "jsx-945736273 flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300", children: "📷 Upload Photo" }),
              /* @__PURE__ */ jsx("button", { onClick: () => setActiveTab("ai"), style: {
                background: isAiTab ? "linear-gradient(135deg,#b24bf3,#ff1493)" : "transparent",
                color: isAiTab ? "black" : "rgba(255,255,255,0.5)"
              }, className: "jsx-945736273 flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300", children: "✨ AI Generate" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "jsx-945736273 p-6", children: [
            isUploadTab && /* @__PURE__ */ jsx(ImageUploadSection, { handleFileChange, uploading }),
            isAiTab && /* @__PURE__ */ jsx(AIGenerationForm, { handleGenerateAI, isGenerating: generateAIMutation.isLoading, autoSaveToGallery, setAutoSaveToGallery, autoSaveAfterUpload, setAutoSaveAfterUpload, canAutoSave }),
            /* @__PURE__ */ jsx("div", { className: "jsx-945736273 my-6 border-t border-white/5" }),
            /* @__PURE__ */ jsx(StyleSelector, { style, setStyle, customColor, setCustomColor }),
            /* @__PURE__ */ jsx("div", { className: "jsx-945736273 my-6 border-t border-white/5" }),
            /* @__PURE__ */ jsx(ChainControls, { scale, setScale, offsetY, setOffsetY }),
            /* @__PURE__ */ jsx(BackgroundPositionControls, { sourceUrl, bgScale, setBgScale, bgOffsetX, setBgOffsetX, bgOffsetY, setBgOffsetY, resetPosition })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "jsx-945736273 flex flex-col gap-6 lg:sticky lg:top-8", children: [
          /* @__PURE__ */ jsx(CanvasPreview, { canvasRef, sourceUrl, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp, onCanvasPointerCancel }),
          /* @__PURE__ */ jsx(ActionButtons, { sourceUrl, handleDownload, handleSaveToGallery, isSaving: saveUploadMutation.isLoading, error, lastSavedUrl })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(_JSXStyle, { id: "945736273", children: ["@-webkit-keyframes cuhzSpin{from{-webkit-transform:rotate(0deg);-ms-transform:rotate(0deg);transform:rotate(0deg);}to{-webkit-transform:rotate(360deg);-ms-transform:rotate(360deg);transform:rotate(360deg);}}", "@keyframes cuhzSpin{from{-webkit-transform:rotate(0deg);-ms-transform:rotate(0deg);transform:rotate(0deg);}to{-webkit-transform:rotate(360deg);-ms-transform:rotate(360deg);transform:rotate(360deg);}}", "@-webkit-keyframes cuhzPulse{0%,100%{opacity:0.4;}50%{opacity:0.7;}}", "@keyframes cuhzPulse{0%,100%{opacity:0.4;}50%{opacity:0.7;}}"] })
  ] });
}
const page$4 = UNSAFE_withComponentProps(function WrappedPage7(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(ChainGeneratorPage, {
      ...props
    })
  });
});
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$4
}, Symbol.toStringTag, { value: "Module" }));
function normalizeChannelLogin(channel) {
  return String(channel || "").trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_]/g, "");
}
function CuhzBotRequestPage() {
  const {
    user,
    loading,
    logout
  } = useTwitchAuth();
  const bgStyle = useMemo(() => ({
    background: "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)"
  }), []);
  const [channel, setChannel] = useState("");
  const [botSuccess, setBotSuccess] = useState(null);
  const requestBotMutation = useMutation({
    mutationFn: async (channelLogin) => {
      const res = await fetch("/api/bot/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channel: channelLogin
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `When fetching /api/bot/request, the response was [${res.status}] ${res.statusText}`;
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: (data) => {
      setBotSuccess(data);
      const msg = data?.message || "Request saved";
      toast.success(msg);
    },
    onError: (e) => {
      console.error(e);
      toast.error(e?.message || "Could not save request");
    }
  });
  const submitBotRequest = useCallback((e) => {
    e.preventDefault();
    const cleaned = normalizeChannelLogin(channel);
    if (!cleaned) {
      toast.error("Please enter a Twitch username");
      return;
    }
    setBotSuccess(null);
    requestBotMutation.mutate(cleaned);
  }, [channel, requestBotMutation]);
  const [email, setEmail] = useState("");
  const [requestType, setRequestType] = useState("ai_home_assistant");
  const [details, setDetails] = useState("");
  const [serviceSuccess, setServiceSuccess] = useState(null);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const url = new URL(window.location.href);
      const qsEmail = url.searchParams.get("email");
      const qsType = url.searchParams.get("requestType");
      const qsDetails = url.searchParams.get("details");
      if (qsEmail && email.trim() === "") {
        setEmail(qsEmail);
      }
      const allowedTypes = /* @__PURE__ */ new Set(["ai_home_assistant", "ai_dev_team"]);
      if (qsType && allowedTypes.has(qsType) && qsType !== requestType) {
        setRequestType(qsType);
      }
      if (qsDetails && details.trim() === "") {
        setDetails(qsDetails);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);
  const requestServiceMutation = useMutation({
    mutationFn: async ({
      email: email2,
      requestType: requestType2,
      details: details2
    }) => {
      const res = await fetch("/api/services/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email2,
          requestType: requestType2,
          details: details2
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `When fetching /api/services/request, the response was [${res.status}] ${res.statusText}`;
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: (data) => {
      setServiceSuccess(data);
      toast.success(data?.message || "Request sent");
    },
    onError: (e) => {
      console.error(e);
      toast.error(e?.message || "Could not submit request");
    }
  });
  const submitServiceRequest = useCallback((e) => {
    e.preventDefault();
    setServiceSuccess(null);
    requestServiceMutation.mutate({
      email: email.trim(),
      requestType,
      details: details.trim()
    });
  }, [email, requestType, details, requestServiceMutation]);
  const botBlurb = "Enter your Twitch username and we’ll add CuhzBot to your channel in less than 48 hours — for free.";
  return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white", style: {
    backgroundColor: "#0a0e27"
  }, children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: bgStyle }),
    /* @__PURE__ */ jsxs("div", { className: "max-w-[1200px] mx-auto px-6 py-10", children: [
      /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between", children: [
        /* @__PURE__ */ jsxs("a", { href: "/", className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsx("img", { src: "https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/", alt: "Planet Cuhz logo", className: "h-10 w-auto rounded-sm" }),
          /* @__PURE__ */ jsx("span", { className: "text-lg font-semibold tracking-wide", children: "CuhzBot" })
        ] }),
        loading ? /* @__PURE__ */ jsx("div", { className: "px-4 py-2 rounded-xl border border-white/15", children: "Loading..." }) : user ? /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsx("a", { href: "/dashboard", className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Dashboard" }),
          /* @__PURE__ */ jsx("button", { onClick: logout, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Logout" })
        ] }) : /* @__PURE__ */ jsx("button", { onClick: startTwitchLogin, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors", children: "Login with Twitch" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6", children: [
        /* @__PURE__ */ jsxs("section", { className: "rounded-2xl border border-white/10 bg-white/5 p-6", children: [
          /* @__PURE__ */ jsx("h1", { className: "text-2xl font-bold", children: "Request CuhzBot" }),
          /* @__PURE__ */ jsx("p", { className: "mt-3 text-white/80 text-sm", children: botBlurb }),
          /* @__PURE__ */ jsxs("form", { className: "mt-5 flex flex-col sm:flex-row gap-3", onSubmit: submitBotRequest, children: [
            /* @__PURE__ */ jsx("input", { value: channel, onChange: (e) => setChannel(e.target.value), placeholder: "yourtwitchusername", className: "flex-1 rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm outline-none focus:border-white/35" }),
            /* @__PURE__ */ jsx("button", { type: "submit", disabled: requestBotMutation.isLoading, className: "px-6 py-3 rounded-xl font-semibold text-black disabled:opacity-50", style: {
              background: "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)"
            }, children: requestBotMutation.isLoading ? "Saving…" : "Request Bot" })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "mt-4 text-xs text-white/60", children: "Tip: your Twitch username is the part after twitch.tv/ (no spaces)." }),
          botSuccess?.ok && /* @__PURE__ */ jsxs("div", { className: "mt-5 rounded-xl border border-[#00f5ff]/20 bg-[#00f5ff]/10 p-4", children: [
            /* @__PURE__ */ jsx("div", { className: "font-semibold", children: "Request received" }),
            /* @__PURE__ */ jsx("div", { className: "mt-1 text-sm text-white/85", children: botSuccess?.message })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("section", { id: "ai", className: "rounded-2xl border border-white/10 bg-white/5 p-6", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-2xl font-bold", children: "Want your own AI?" }),
          /* @__PURE__ */ jsx("p", { className: "mt-3 text-white/80 text-sm", children: "If you want your own AI home assistant or an AI development team, request a quote here and we’ll email you instructions + pricing." }),
          /* @__PURE__ */ jsxs("form", { className: "mt-5 grid grid-cols-1 gap-3", onSubmit: submitServiceRequest, children: [
            /* @__PURE__ */ jsx("input", { value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", className: "rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm outline-none focus:border-white/35" }),
            /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-3", children: [
              /* @__PURE__ */ jsxs("label", { className: "rounded-xl border border-white/15 px-4 py-3 text-sm", children: [
                /* @__PURE__ */ jsx("div", { className: "text-white/70 text-xs", children: "Request type" }),
                /* @__PURE__ */ jsxs("select", { value: requestType, onChange: (e) => setRequestType(e.target.value), className: "mt-1 w-full bg-transparent outline-none", children: [
                  /* @__PURE__ */ jsx("option", { value: "ai_home_assistant", children: "AI Home Assistant" }),
                  /* @__PURE__ */ jsx("option", { value: "ai_dev_team", children: "AI Development Team" })
                ] })
              ] }),
              /* @__PURE__ */ jsx("button", { type: "submit", disabled: requestServiceMutation.isLoading, className: "px-6 py-3 rounded-xl font-semibold border border-white/15 hover:border-white/30 disabled:opacity-50", children: requestServiceMutation.isLoading ? "Sending…" : "Request Quote" })
            ] }),
            /* @__PURE__ */ jsx("textarea", { value: details, onChange: (e) => setDetails(e.target.value), rows: 4, placeholder: "Tell us what you’re trying to build (optional)…", className: "rounded-xl border border-white/15 bg-transparent px-4 py-3 text-sm outline-none focus:border-white/35" }),
            serviceSuccess?.ok && /* @__PURE__ */ jsxs("div", { className: "rounded-xl border border-[#b24bf3]/25 bg-[#b24bf3]/10 p-4", children: [
              /* @__PURE__ */ jsx("div", { className: "font-semibold", children: "Request sent" }),
              /* @__PURE__ */ jsx("div", { className: "mt-1 text-sm text-white/85", children: serviceSuccess?.message })
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "mt-10 rounded-2xl border border-white/10 bg-white/5 p-6", children: /* @__PURE__ */ jsxs("div", { className: "text-sm text-white/80", children: [
        "Want to make chain art too? Try the",
        " ",
        /* @__PURE__ */ jsx("a", { className: "underline", href: "/chain-generator", children: "Chain Generator" }),
        "."
      ] }) })
    ] })
  ] });
}
const page$3 = UNSAFE_withComponentProps(function WrappedPage8(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(CuhzBotRequestPage, {
      ...props
    })
  });
});
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$3
}, Symbol.toStringTag, { value: "Module" }));
function DashboardPage() {
  const {
    user,
    loading,
    logout
  } = useTwitchAuth();
  const queryClient2 = useQueryClient();
  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);
  const [channelToAdd, setChannelToAdd] = useState("");
  const [addResult, setAddResult] = useState(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const upgraded = url.searchParams.get("upgrade");
    const twitchLogin = url.searchParams.get("twitch_login");
    if (upgraded === "success") {
      toast.success("You're Pro now! Enjoy unlimited generations.");
      url.searchParams.delete("upgrade");
      window.history.replaceState({}, "", url.toString());
    }
    if (twitchLogin === "success") {
      toast.success("Welcome back! You're signed in.");
      url.searchParams.delete("twitch_login");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);
  const {
    data: discord,
    isLoading: discordLoading
  } = useQuery({
    queryKey: ["discord-settings"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/discord/settings");
      if (!res.ok) throw new Error("Failed to load Discord settings");
      return res.json();
    },
    enabled: !!user
  });
  const saveDiscord = useMutation({
    mutationFn: async ({
      webhookUrl,
      autoPost,
      test
    }) => {
      const res = await fetch("/api/integrations/discord/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          webhookUrl,
          autoPost,
          test
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save Discord settings");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Discord settings saved");
      queryClient2.invalidateQueries({
        queryKey: ["discord-settings"]
      });
    },
    onError: (e) => {
      console.error(e);
      toast.error("Could not save Discord settings");
    }
  });
  const {
    data: botSettings,
    isLoading: botLoading
  } = useQuery({
    queryKey: ["twitch-bot-settings"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/twitch-bot/settings");
      if (!res.ok) throw new Error("Failed to load bot settings");
      return res.json();
    },
    enabled: !!user
  });
  const saveBot = useMutation({
    mutationFn: async ({
      enabled,
      regenerateToken
    }) => {
      const res = await fetch("/api/integrations/twitch-bot/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          enabled,
          regenerateToken
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save bot settings");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Bot settings saved");
      queryClient2.invalidateQueries({
        queryKey: ["twitch-bot-settings"]
      });
    },
    onError: (e) => {
      console.error(e);
      toast.error("Could not save bot settings");
    }
  });
  const {
    data: myChannels,
    isLoading: myChannelsLoading
  } = useQuery({
    queryKey: ["bot-my-channels"],
    queryFn: async () => {
      const res = await fetch("/api/bot/my-channels");
      if (res.status === 401) {
        return {
          channels: []
        };
      }
      if (!res.ok) {
        throw new Error("Failed to load bot channels");
      }
      return res.json();
    },
    enabled: !!user
  });
  const addChannel = useMutation({
    mutationFn: async (channel) => {
      const res = await fetch("/api/bot/add-channel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channel
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to add channel");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAddResult(data);
      const msg = data?.message || "Channel saved";
      toast.success(msg);
      queryClient2.invalidateQueries({
        queryKey: ["bot-my-channels"]
      });
    },
    onError: (e) => {
      console.error(e);
      toast.error(e?.message || "Could not add channel");
    }
  });
  return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white", style: {
    backgroundColor: "#0a0e27"
  }, children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: {
      background: "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)"
    } }),
    /* @__PURE__ */ jsxs("div", { className: "max-w-[1200px] mx-auto px-6 py-10", children: [
      /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between", children: [
        /* @__PURE__ */ jsxs("a", { href: "/", className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsx("img", { src: "https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/", alt: "Planet Cuhz logo", className: "h-10 w-auto rounded-sm" }),
          /* @__PURE__ */ jsx("span", { className: "text-lg font-semibold tracking-wide", children: "My Dashboard" })
        ] }),
        loading ? /* @__PURE__ */ jsx("div", { className: "px-4 py-2 rounded-xl border border-white/15", children: "Loading..." }) : user ? /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
            user.profile_image_url && /* @__PURE__ */ jsx("img", { src: user.profile_image_url, alt: user.display_name || user.username, className: "w-8 h-8 rounded-full" }),
            /* @__PURE__ */ jsxs("span", { className: "text-sm", children: [
              user.display_name || user.username,
              user.role === "admin" && /* @__PURE__ */ jsx("span", { className: "ml-1 text-xs bg-gradient-to-r from-[#00f5ff] to-[#b24bf3] text-black px-2 py-0.5 rounded-full font-semibold", children: "ADMIN" }),
              user.plan === "pro" && /* @__PURE__ */ jsx("span", { className: "ml-1 text-xs bg-[#ffd700] text-black px-2 py-0.5 rounded-full font-semibold", children: "PRO" })
            ] })
          ] }),
          user.plan === "pro" ? /* @__PURE__ */ jsx("button", { onClick: async () => {
            try {
              const res = await fetch("/api/billing/create-portal-session", {
                method: "POST"
              });
              if (!res.ok) throw new Error("Failed to open billing portal");
              const data = await res.json();
              if (!data.url) throw new Error("No portal URL returned");
              const popup = window.open(data.url, "_blank", "popup");
              if (!popup) window.location.href = data.url;
            } catch (e) {
              console.error(e);
              toast.error("Could not open billing portal.");
            }
          }, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Manage Billing" }) : /* @__PURE__ */ jsx("a", { href: "/pricing", className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Go Pro" }),
          /* @__PURE__ */ jsx("button", { onClick: logout, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Logout" })
        ] }) : /* @__PURE__ */ jsx("button", { onClick: startTwitchLogin, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors", children: "Login with Twitch" })
      ] }),
      /* @__PURE__ */ jsx("section", { className: "mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5", children: ["Commands used today", "Messages sent", "New chatters welcomed"].map((title, i) => /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsx("div", { className: "text-sm text-white/70", children: title }),
        /* @__PURE__ */ jsx("div", { className: "text-3xl font-bold mt-2", children: "--" })
      ] }, i)) }),
      /* @__PURE__ */ jsxs("section", { className: "mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6", children: [
        /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-5", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Bot Settings" }),
          /* @__PURE__ */ jsxs("div", { className: "mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm", children: [
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", defaultChecked: true, className: "accent-[#b24bf3]" }),
              " ",
              "Auto-welcome new chatters"
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", defaultChecked: true, className: "accent-[#b24bf3]" }),
              " ",
              "Marketing messages (30 min)"
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", className: "accent-[#b24bf3]" }),
              " Queue system"
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx("input", { type: "checkbox", className: "accent-[#b24bf3]" }),
              " Raid messages"
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-5", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Custom Commands" }),
          /* @__PURE__ */ jsx("div", { className: "mt-4 text-sm text-white/80", children: "Coming soon" })
        ] })
      ] }),
      user && /* @__PURE__ */ jsxs("section", { className: "mt-10 rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Twitch Bot Integration" }),
        /* @__PURE__ */ jsxs("p", { className: "mt-2 text-sm text-white/80", children: [
          "Enable chat commands and connect your bot or a simple webhook to Planet Cuhz. Supported commands:",
          " ",
          /* @__PURE__ */ jsx("code", { className: "bg-white/10 px-1 py-0.5 rounded", children: "!cuhz help" }),
          " ",
          "and",
          " ",
          /* @__PURE__ */ jsx("code", { className: "bg-white/10 px-1 py-0.5 rounded", children: "!chain <prompt>" }),
          "."
        ] }),
        /* @__PURE__ */ jsxs("form", { className: "mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm", onSubmit: (e) => {
          e.preventDefault();
          const enabled = Boolean(e.currentTarget.elements.namedItem("botEnabled").checked);
          saveBot.mutate({
            enabled
          });
        }, children: [
          /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2 md:col-span-1 rounded-xl border border-white/15 px-3 py-2", children: [
            /* @__PURE__ */ jsx("input", { type: "checkbox", name: "botEnabled", defaultChecked: Boolean(botSettings?.bot_enabled), className: "accent-[#b24bf3]", disabled: botLoading }),
            "Enable bot"
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "md:col-span-4 grid grid-cols-1 sm:grid-cols-3 gap-3", children: [
            /* @__PURE__ */ jsxs("div", { className: "col-span-2 flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2", children: [
              /* @__PURE__ */ jsx("span", { className: "shrink-0 text-white/70", children: "Webhook" }),
              /* @__PURE__ */ jsx("input", { readOnly: true, value: origin ? `${origin}/api/bot/command` : "/api/bot/command", className: "w-full bg-transparent outline-none" }),
              /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
                const v = origin ? `${origin}/api/bot/command` : "/api/bot/command";
                navigator.clipboard.writeText(v).then(() => toast.success("Webhook URL copied"));
              }, className: "px-2 py-1 rounded border border-white/15 hover:border-white/30", children: "Copy" })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "col-span-1 flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2", children: [
              /* @__PURE__ */ jsx("span", { className: "shrink-0 text-white/70", children: "Token" }),
              /* @__PURE__ */ jsx("input", { readOnly: true, value: botSettings?.bot_webhook_token || "(enable to generate)", className: "w-full bg-transparent outline-none" }),
              /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
                if (!botSettings?.bot_webhook_token) return;
                navigator.clipboard.writeText(botSettings.bot_webhook_token).then(() => toast.success("Token copied"));
              }, className: "px-2 py-1 rounded border border-white/15 hover:border-white/30", children: "Copy" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "md:col-span-5 flex items-center gap-2", children: [
            /* @__PURE__ */ jsx("button", { type: "submit", disabled: saveBot.isLoading, className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50", children: saveBot.isLoading ? "Saving…" : "Save" }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => saveBot.mutate({
              enabled: true,
              regenerateToken: true
            }), className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30", children: "Regenerate Token" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "mt-6 rounded-2xl border border-white/10 bg-black/20 p-4", children: [
          /* @__PURE__ */ jsxs("div", { className: "flex flex-col md:flex-row md:items-center md:justify-between gap-3", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("div", { className: "font-semibold", children: "Add CuhzBot to your channel" }),
              /* @__PURE__ */ jsx("div", { className: "text-xs text-white/70 mt-1", children: "This creates a verify code. The bot will join your channel (pending) and you verify it in chat." })
            ] }),
            /* @__PURE__ */ jsxs("form", { className: "flex flex-col sm:flex-row gap-2 w-full md:w-auto", onSubmit: (e) => {
              e.preventDefault();
              const next = channelToAdd.trim();
              if (!next) return;
              addChannel.mutate(next);
            }, children: [
              /* @__PURE__ */ jsx("input", { value: channelToAdd, onChange: (e) => setChannelToAdd(e.target.value), placeholder: "yourtwitchchannel", className: "rounded-xl border border-white/15 bg-transparent px-3 py-2 text-sm w-full sm:w-[260px]" }),
              /* @__PURE__ */ jsx("button", { type: "submit", disabled: addChannel.isLoading || !channelToAdd.trim(), className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50 text-sm", children: addChannel.isLoading ? "Adding…" : "Add Channel" })
            ] })
          ] }),
          addResult?.success && /* @__PURE__ */ jsxs("div", { className: "mt-4 rounded-xl border border-[#b24bf3]/30 bg-[#b24bf3]/10 p-4", children: [
            /* @__PURE__ */ jsxs("div", { className: "text-sm font-semibold", children: [
              "Channel: ",
              addResult.channel
            ] }),
            addResult.status === "pending" ? /* @__PURE__ */ jsxs("div", { className: "mt-2 text-sm text-white/80", children: [
              /* @__PURE__ */ jsx("div", { className: "mt-2", children: "Do this in your Twitch chat:" }),
              /* @__PURE__ */ jsxs("ol", { className: "mt-2 list-decimal list-inside space-y-1", children: [
                /* @__PURE__ */ jsxs("li", { children: [
                  /* @__PURE__ */ jsx("span", { className: "text-white/70", children: "Mod the bot:" }),
                  " ",
                  /* @__PURE__ */ jsx("code", { className: "bg-black/30 px-2 py-0.5 rounded", children: "/mod CuhzBot" })
                ] }),
                /* @__PURE__ */ jsxs("li", { children: [
                  /* @__PURE__ */ jsx("span", { className: "text-white/70", children: "Verify:" }),
                  " ",
                  /* @__PURE__ */ jsxs("code", { className: "bg-black/30 px-2 py-0.5 rounded", children: [
                    "!cuhz verify ",
                    addResult.verifyCode
                  ] })
                ] }),
                /* @__PURE__ */ jsxs("li", { children: [
                  /* @__PURE__ */ jsx("span", { className: "text-white/70", children: "Wait:" }),
                  " 30–60s for the bot to sync + join"
                ] }),
                /* @__PURE__ */ jsxs("li", { children: [
                  /* @__PURE__ */ jsx("span", { className: "text-white/70", children: "Test:" }),
                  " ",
                  /* @__PURE__ */ jsx("code", { className: "bg-black/30 px-2 py-0.5 rounded", children: "!chain hello" })
                ] })
              ] }),
              /* @__PURE__ */ jsx("div", { className: "mt-3 text-xs text-white/70", children: "Your verify code" }),
              /* @__PURE__ */ jsx("div", { className: "mt-1 font-mono text-lg text-[#00f5ff]", children: addResult.verifyCode })
            ] }) : /* @__PURE__ */ jsxs("div", { className: "mt-2 text-sm text-white/80", children: [
              "✅ Verified. Try",
              " ",
              /* @__PURE__ */ jsx("code", { className: "bg-black/30 px-2 py-0.5 rounded", children: "!chain hello" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "mt-4", children: [
            /* @__PURE__ */ jsx("div", { className: "text-sm font-semibold", children: "Your channels" }),
            /* @__PURE__ */ jsxs("div", { className: "mt-2 rounded-xl border border-white/10 overflow-hidden", children: [
              /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-3 bg-white/5 px-3 py-2 text-xs text-white/70", children: [
                /* @__PURE__ */ jsx("div", { children: "Channel" }),
                /* @__PURE__ */ jsx("div", { children: "Status" }),
                /* @__PURE__ */ jsx("div", { children: "Verify" })
              ] }),
              /* @__PURE__ */ jsx("div", { className: "divide-y divide-white/10", children: myChannelsLoading ? /* @__PURE__ */ jsx("div", { className: "px-3 py-3 text-sm text-white/70", children: "Loading…" }) : (myChannels?.channels || []).length === 0 ? /* @__PURE__ */ jsx("div", { className: "px-3 py-3 text-sm text-white/70", children: "No channels yet. Add one above." }) : (myChannels?.channels || []).map((c) => {
                const verifyText = c.status === "pending" ? `!cuhz verify ${c.verify_code || ""}` : "—";
                return /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-3 px-3 py-2 text-sm", children: [
                  /* @__PURE__ */ jsx("div", { className: "font-mono", children: c.channel_login }),
                  /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx("span", { className: "inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-xs", children: c.status }) }),
                  /* @__PURE__ */ jsx("div", { className: "text-xs text-white/70 font-mono break-all", children: verifyText })
                ] }, c.id);
              }) })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "mt-4 text-xs text-white/70 space-y-1", children: [
          /* @__PURE__ */ jsx("div", { children: "How to use (example):" }),
          /* @__PURE__ */ jsx("pre", { className: "whitespace-pre-wrap break-all bg-black/30 rounded p-3", children: `POST ${origin}/api/bot/command
Content-Type: application/json

{
  "token": "${botSettings?.bot_webhook_token || "<your-token>"}",
  "channel": "yourchannel",
  "user": { "id": "viewer123", "name": "viewer" },
  "text": "!chain astronaut with CUHZ chain"
}` })
        ] })
      ] }),
      user && /* @__PURE__ */ jsxs("section", { className: "mt-10 rounded-2xl border border-white/10 bg-white/5 p-5", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "Discord Integration" }),
        /* @__PURE__ */ jsx("p", { className: "mt-2 text-sm text-white/80", children: "Add a Discord webhook to share your new creations automatically or on demand. Create a webhook in your Discord channel → Edit Channel → Integrations → Webhooks." }),
        /* @__PURE__ */ jsxs("form", { className: "mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm", onSubmit: (e) => {
          e.preventDefault();
          const webhookUrl = e.currentTarget.webhook.value.trim();
          const autoPost = e.currentTarget.autoPost.checked;
          saveDiscord.mutate({
            webhookUrl,
            autoPost
          });
        }, children: [
          /* @__PURE__ */ jsx("input", { name: "webhook", defaultValue: discord?.discord_webhook_url || "", placeholder: "https://discord.com/api/webhooks/...", className: "md:col-span-3 rounded-xl border border-white/15 bg-transparent px-3 py-2", disabled: discordLoading }),
          /* @__PURE__ */ jsxs("label", { className: "flex items-center gap-2 md:col-span-1 rounded-xl border border-white/15 px-3 py-2", children: [
            /* @__PURE__ */ jsx("input", { type: "checkbox", name: "autoPost", defaultChecked: Boolean(discord?.discord_auto_post), className: "accent-[#b24bf3]", disabled: discordLoading }),
            "Auto-post new creations"
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 md:col-span-1", children: [
            /* @__PURE__ */ jsx("button", { type: "submit", disabled: saveDiscord.isLoading, className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-50", children: saveDiscord.isLoading ? "Saving…" : "Save" }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => {
              const webhookUrl = (document.querySelector('input[name="webhook"]')?.value || "").trim();
              const autoPost = Boolean(document.querySelector('input[name="autoPost"]')?.checked);
              saveDiscord.mutate({
                webhookUrl,
                autoPost,
                test: true
              }, {
                onSuccess: () => toast.success("Test sent to Discord")
              });
            }, className: "px-3 py-2 rounded-xl border border-white/15 hover:border-white/30", children: "Test" })
          ] })
        ] })
      ] })
    ] })
  ] });
}
const page$2 = UNSAFE_withComponentProps(function WrappedPage9(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(DashboardPage, {
      ...props
    })
  });
});
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$2
}, Symbol.toStringTag, { value: "Module" }));
function GalleryPage() {
  const {
    user,
    loading,
    logout
  } = useTwitchAuth();
  const queryClient2 = useQueryClient();
  const [methodFilter, setMethodFilter] = useState("all");
  const [styleFilter, setStyleFilter] = useState("all");
  const bgStyle = useMemo(() => ({
    background: "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)"
  }), []);
  const queryKey = useMemo(() => ["my-generations", {
    methodFilter,
    styleFilter
  }], [methodFilter, styleFilter]);
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey,
    queryFn: async ({
      pageParam
    }) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (pageParam) params.set("cursor", String(pageParam));
      if (methodFilter !== "all") params.set("method", methodFilter);
      if (styleFilter !== "all") params.set("style", styleFilter);
      const res = await fetch(`/api/chain/generations?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`When fetching /api/chain/generations, the response was [${res.status}] ${res.statusText}`);
      }
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? void 0,
    enabled: !!user
  });
  const deleteGeneration = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`/api/chain/generations/${id}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Deleted");
      queryClient2.invalidateQueries({
        queryKey: ["my-generations"]
      });
    },
    onError: (e) => {
      console.error(e);
      toast.error("Could not delete");
    }
  });
  const shareToDiscord = useMutation({
    mutationFn: async (generationId) => {
      const res = await fetch("/api/integrations/discord/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          generationId
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to share to Discord");
      }
      return res.json();
    },
    onSuccess: () => toast.success("Shared to Discord"),
    onError: (e) => {
      const msg = String(e?.message || "");
      if (msg.toLowerCase().includes("webhook") || msg.toLowerCase().includes("not configured")) {
        toast.error("Add a Discord webhook in Dashboard → Discord Integration");
      } else {
        toast.error("Could not share to Discord");
      }
    }
  });
  useEffect(() => {
    if (isError) {
      toast.error("Could not load your gallery");
    }
  }, [isError]);
  const items = (data?.pages || []).flatMap((p) => p.items || []);
  const onCopy = useCallback(async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch (e) {
      console.error(e);
      toast.error("Could not copy link");
    }
  }, []);
  const formatStyle = (s) => {
    if (!s) return null;
    const lower = String(s).toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  if (loading) {
    return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white", style: {
      backgroundColor: "#0a0e27"
    }, children: [
      /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: bgStyle }),
      /* @__PURE__ */ jsx("div", { className: "max-w-[1200px] mx-auto px-6 py-10", children: "Loading..." })
    ] });
  }
  if (!user) {
    return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white", style: {
      backgroundColor: "#0a0e27"
    }, children: [
      /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: bgStyle }),
      /* @__PURE__ */ jsxs("div", { className: "max-w-[1200px] mx-auto px-6 py-10", children: [
        /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between", children: [
          /* @__PURE__ */ jsxs("a", { href: "/", className: "flex items-center gap-3", children: [
            /* @__PURE__ */ jsx("img", { src: "https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/", alt: "Planet Cuhz logo", className: "h-10 w-auto rounded-sm" }),
            /* @__PURE__ */ jsx("span", { className: "text-lg font-semibold tracking-wide", children: "My Gallery" })
          ] }),
          /* @__PURE__ */ jsx("button", { onClick: startTwitchLogin, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors", children: "Login with Twitch" })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mt-8 rounded-2xl border border-white/10 bg-white/5 p-6", children: "Please sign in to view your creations." })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { className: "min-h-screen text-white", style: {
    backgroundColor: "#0a0e27"
  }, children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 -z-10", style: bgStyle }),
    /* @__PURE__ */ jsxs("div", { className: "max-w-[1200px] mx-auto px-6 py-10", children: [
      /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between", children: [
        /* @__PURE__ */ jsxs("a", { href: "/", className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsx("img", { src: "https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/", alt: "Planet Cuhz logo", className: "h-10 w-auto rounded-sm" }),
          /* @__PURE__ */ jsx("span", { className: "text-lg font-semibold tracking-wide", children: "My Gallery" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsx("a", { href: "/chain-generator", className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Create More" }),
          /* @__PURE__ */ jsx("button", { onClick: logout, className: "px-4 py-2 rounded-xl border border-white/15 hover:border-white/30 transition-colors text-sm", children: "Logout" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "mt-6 rounded-2xl border border-white/10 bg-white/5 p-4", children: [
        /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm", children: [
          /* @__PURE__ */ jsxs("label", { className: "flex flex-col gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: "text-white/70 text-xs", children: "Method" }),
            /* @__PURE__ */ jsxs("select", { value: methodFilter, onChange: (e) => setMethodFilter(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", children: [
              /* @__PURE__ */ jsx("option", { value: "all", children: "All" }),
              /* @__PURE__ */ jsx("option", { value: "ai", children: "AI" }),
              /* @__PURE__ */ jsx("option", { value: "upload", children: "Upload" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "flex flex-col gap-2", children: [
            /* @__PURE__ */ jsx("span", { className: "text-white/70 text-xs", children: "Style" }),
            /* @__PURE__ */ jsxs("select", { value: styleFilter, onChange: (e) => setStyleFilter(e.target.value), className: "rounded-xl border border-white/15 bg-transparent px-3 py-2", children: [
              /* @__PURE__ */ jsx("option", { value: "all", children: "All" }),
              /* @__PURE__ */ jsx("option", { value: "rainbow", children: "Rainbow" }),
              /* @__PURE__ */ jsx("option", { value: "gold", children: "Gold" }),
              /* @__PURE__ */ jsx("option", { value: "silver", children: "Silver" }),
              /* @__PURE__ */ jsx("option", { value: "iced", children: "Iced" }),
              /* @__PURE__ */ jsx("option", { value: "custom", children: "Custom" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mt-3 text-xs text-white/60", children: "Tip: Filters update automatically." })
      ] }),
      /* @__PURE__ */ jsx("section", { className: "mt-8", children: isLoading ? /* @__PURE__ */ jsx("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-6", children: "Loading your gallery…" }) : items.length === 0 ? /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 p-6", children: [
        /* @__PURE__ */ jsx("div", { className: "text-white/80", children: "No creations yet. Try the generator!" }),
        /* @__PURE__ */ jsx("a", { href: "/chain-generator", className: "inline-block mt-4 px-5 py-3 rounded-xl font-semibold border border-white/20 hover:border-white/40 transition-colors", children: "Open Chain Generator" })
      ] }) : /* @__PURE__ */ jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5", children: (items || []).map((item) => {
        const styleLabel = formatStyle(item.style);
        const canDelete = Boolean(user);
        return /* @__PURE__ */ jsxs("div", { className: "rounded-2xl border border-white/10 bg-white/5 overflow-hidden group", children: [
          /* @__PURE__ */ jsx("div", { className: "aspect-square bg-black/20 overflow-hidden", children: /* @__PURE__ */ jsx("img", { src: item.image_url, alt: item.prompt || "Generated image", className: "w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]", loading: "lazy" }) }),
          /* @__PURE__ */ jsxs("div", { className: "p-4 flex items-center justify-between gap-3", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsxs("div", { className: "text-xs uppercase tracking-wide text-white/60", children: [
                item.method,
                styleLabel && /* @__PURE__ */ jsx("span", { className: "ml-2 inline-block text-[10px] uppercase bg-white/10 border border-white/15 rounded-full px-2 py-0.5 text-white/80", children: styleLabel })
              ] }),
              item.prompt && /* @__PURE__ */ jsx("div", { className: "mt-1 text-sm line-clamp-2 text-white/85", title: item.prompt, children: item.prompt })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center justify-end gap-2", children: [
              /* @__PURE__ */ jsx("a", { href: item.image_url, download: true, className: "px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-xs", children: "Download" }),
              /* @__PURE__ */ jsx("button", { onClick: () => onCopy(item.image_url), className: "px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-xs", children: "Copy link" }),
              /* @__PURE__ */ jsx("button", { onClick: () => shareToDiscord.mutate(item.id), disabled: shareToDiscord.isLoading, className: "px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-xs disabled:opacity-50", children: "Share to Discord" }),
              canDelete && /* @__PURE__ */ jsx("button", { onClick: () => {
                const ok = window.confirm("Delete this image from your gallery?");
                if (!ok) return;
                deleteGeneration.mutate(item.id);
              }, disabled: deleteGeneration.isLoading, className: "px-3 py-1.5 rounded-lg border border-red-400/40 hover:border-red-300 text-xs disabled:opacity-50", children: "Delete" })
            ] })
          ] })
        ] }, item.id);
      }) }) }),
      hasNextPage && /* @__PURE__ */ jsx("div", { className: "mt-8 flex justify-center", children: /* @__PURE__ */ jsx("button", { onClick: () => fetchNextPage(), disabled: isFetchingNextPage, className: "px-5 py-3 rounded-xl border border-white/15 hover:border-white/30 disabled:opacity-60", children: isFetchingNextPage ? "Loading…" : "Load more" }) })
    ] })
  ] });
}
const page$1 = UNSAFE_withComponentProps(function WrappedPage10(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(GalleryPage, {
      ...props
    })
  });
});
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page$1
}, Symbol.toStringTag, { value: "Module" }));
const CANONICAL_PRICING_URL = "https://planetcuhz.com/pricing";
const OFFER_SECTIONS = [{
  id: "membership",
  eyebrow: "Membership",
  title: "Planet CUHZ Membership",
  scope: "Site-wide; nothing here is a chat-bot feature.",
  description: "Choose the site experience that fits you, from free creation tools to a complete squad workspace.",
  offers: [{
    id: "free",
    name: "FREE",
    price: "$0 forever",
    features: ["Chain Studio — full access, right in your browser", "Browse squads, streams, and Cuhzunity events", "Request CUHZ Bot for your Twitch chat — free", "Starter AI tools with monthly limits"],
    cta: {
      label: "Start Free",
      href: "https://planetcuhz.com/auth"
    }
  }, {
    id: "pro",
    name: "PRO",
    price: "$9.99/month",
    features: ["Everything in Free", "Unlimited AI tools and emote generations", "Front of the line when you request CUHZ Bot for your channel", "Full creator feature set, day one", "Pro badge across the Cuhzunity"],
    featured: true,
    cta: {
      label: "Go Pro",
      href: CANONICAL_PRICING_URL,
      checkout: true
    }
  }, {
    id: "team",
    name: "TEAM",
    price: "$24.99/month",
    features: ["Everything in Pro — for your whole squad", "Squad tools: roster, scrims, and run scheduling", "Coaching perks with community coaches", "Team spotlight across the Cuhzunity"],
    cta: {
      label: "Build Your Squad",
      href: CANONICAL_PRICING_URL,
      checkout: true
    }
  }]
}, {
  id: "bot",
  eyebrow: "Bot plans",
  title: "CUHZ Bot for Twitch Channels",
  scope: "One plan per Twitch channel, not per viewer.",
  description: "Give the entire chat moderation, community tools, and the level of AI support your channel needs.",
  offers: [{
    id: "community",
    name: "COMMUNITY",
    price: "Free forever",
    features: ["CUHZ Bot live in your chat — free forever", "Moderation and spam control, plus the full command set", "The CUHZ points economy — !points, !top, !rewards", "!shoutouts directory, hype, and links commands"],
    cta: {
      label: "Add It Free",
      href: "https://planetcuhz.com/bot"
    }
  }, {
    id: "silver",
    name: "SILVER",
    price: "$4.99/month",
    features: ["Everything in Community", "Automated socials rotation — your links posted on a timer", "Extra engagement and hype commands unlocked for the channel", "One plan covers the whole chat, not one viewer"],
    cta: {
      label: "Go Silver",
      href: CANONICAL_PRICING_URL,
      checkout: true
    }
  }, {
    id: "gold",
    name: "GOLD",
    price: "$14.99/month",
    features: ["Everything in Silver", "Unlimited AI in chat — Gemini and Claude, fair use", "Includes site Pro membership — one sub covers chat and site", "Priority when the chat is moving fast"],
    featured: true,
    cta: {
      label: "Go Gold",
      href: CANONICAL_PRICING_URL,
      checkout: true
    }
  }, {
    id: "partner",
    name: "PARTNER",
    price: "$49.99/month",
    features: ["Your own branded bot — your name, avatar, and personality", "We host it and run it, so there is nothing for you to maintain", "Everything in Gold, on your channel", "A monthly service touch from a real human — powered by VQNC Labs", "Launching with 5 founding slots — every seat gets real service time"],
    cta: {
      label: "Claim a Founding Slot",
      href: CANONICAL_PRICING_URL,
      checkout: true
    }
  }, {
    id: "architect",
    name: "ARCHITECT CUSTOM BUILD",
    price: "Custom/contact for quote",
    features: ["Custom branding — your name, avatar, and backstory", "Private AI trained on your game, lore, and rules", "Dedicated high-speed private instance", "Full ownership — you keep the build, Discord bridge included"],
    cta: {
      label: "Get a Quote",
      href: "https://planetcuhz.com/solutions#start"
    }
  }]
}, {
  id: "one-time",
  eyebrow: "One-time",
  title: "One-Time Offers",
  scope: "One-time purchases and bookable services — no recurring plan required.",
  description: "Back the community or get focused coaching when you need it.",
  offers: [{
    id: "founders",
    name: "FOUNDERS",
    price: "$99 one-time",
    description: "Back the planet early. Rep the Founders badge and lock in your Pro perks as an OG cuhz.",
    features: [],
    cta: {
      label: "Claim Founders",
      href: CANONICAL_PRICING_URL,
      checkout: true
    }
  }, {
    id: "coaching-sprint",
    name: "COACHING SPRINT",
    price: "$25/session",
    description: "A one-on-one film and gameplay session with a Cuhzunity coach. Book it when you need it.",
    features: [],
    cta: {
      label: "Book a Session",
      href: CANONICAL_PRICING_URL,
      checkout: true
    }
  }]
}];
const gradient = "linear-gradient(90deg,#00f5ff,#b24bf3,#ff1493,#ffd700)";
function OfferCard({
  offer
}) {
  return /* @__PURE__ */ jsxs("article", { className: offer.featured ? "flex h-full flex-col rounded-2xl border border-[#b24bf3]/50 bg-white/[0.08] p-6 shadow-[0_0_28px_rgba(178,75,243,0.22)]" : "flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.05] p-6", children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-start justify-between gap-4", children: [
      /* @__PURE__ */ jsx("h3", { className: "text-xl font-bold tracking-wide", children: offer.name }),
      offer.featured ? /* @__PURE__ */ jsx("span", { className: "rounded-full bg-[#b24bf3]/20 px-2.5 py-1 text-xs font-semibold text-[#e4b8ff]", children: "Popular" }) : null
    ] }),
    /* @__PURE__ */ jsx("p", { className: "mt-3 text-2xl font-extrabold text-white", children: offer.price }),
    offer.description ? /* @__PURE__ */ jsx("p", { className: "mt-4 text-sm leading-6 text-white/75", children: offer.description }) : null,
    offer.features.length > 0 ? /* @__PURE__ */ jsx("ul", { className: "mt-5 flex-1 space-y-3 text-sm leading-6 text-white/80", children: offer.features.map((feature) => /* @__PURE__ */ jsxs("li", { className: "flex gap-2", children: [
      /* @__PURE__ */ jsx("span", { "aria-hidden": "true", className: "mt-0.5 text-[#00f5ff]", children: "✓" }),
      /* @__PURE__ */ jsx("span", { children: feature })
    ] }, feature)) }) : /* @__PURE__ */ jsx("div", { className: "flex-1" }),
    /* @__PURE__ */ jsxs("div", { className: "mt-6", children: [
      /* @__PURE__ */ jsxs("a", { href: offer.cta.href, target: "_blank", rel: "noreferrer", className: offer.featured ? "block rounded-xl px-5 py-3 text-center font-semibold text-black transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#00f5ff] focus:ring-offset-2 focus:ring-offset-[#0a0e27]" : "block rounded-xl border border-white/20 px-5 py-3 text-center font-semibold transition-colors hover:border-white/50 focus:outline-none focus:ring-2 focus:ring-[#00f5ff] focus:ring-offset-2 focus:ring-offset-[#0a0e27]", style: offer.featured ? {
        background: gradient
      } : void 0, children: [
        offer.cta.label,
        /* @__PURE__ */ jsx("span", { className: "sr-only", children: " (opens on PlanetCuhz.com)" })
      ] }),
      offer.cta.checkout ? /* @__PURE__ */ jsx("p", { className: "mt-2 text-center text-xs text-white/55", children: "Secure checkout happens on PlanetCuhz.com." }) : null
    ] })
  ] });
}
function PricingPage() {
  return /* @__PURE__ */ jsx("main", { className: "min-h-screen overflow-hidden text-white", style: {
    backgroundColor: "#0a0e27",
    backgroundImage: "radial-gradient(1200px 600px at 20% -10%, rgba(178,75,243,0.25), transparent), radial-gradient(1000px 500px at 80% 0%, rgba(0,245,255,0.20), transparent), radial-gradient(1200px 600px at 50% 110%, rgba(255,20,147,0.18), transparent)"
  }, children: /* @__PURE__ */ jsxs("div", { className: "mx-auto max-w-[1280px] px-6 py-10", children: [
    /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between gap-4", children: [
      /* @__PURE__ */ jsxs("a", { href: "/", className: "flex items-center gap-3", children: [
        /* @__PURE__ */ jsx("img", { src: "https://ucarecdn.com/3afc6131-98f7-42f7-ba95-e117ff1896f9/-/format/auto/", alt: "Planet CUHZ", className: "h-10 w-auto rounded-sm" }),
        /* @__PURE__ */ jsx("span", { className: "text-lg font-semibold tracking-wide", children: "Pricing & Plans" })
      ] }),
      /* @__PURE__ */ jsx("a", { href: "/dashboard", className: "rounded-xl border border-white/15 px-4 py-2 transition-colors hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-[#00f5ff]", children: "Dashboard" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "py-16 text-center", children: [
      /* @__PURE__ */ jsx("p", { className: "text-sm font-bold uppercase tracking-[0.24em] text-[#00f5ff]", children: "One planet. Clear choices." }),
      /* @__PURE__ */ jsx("h1", { className: "mx-auto mt-4 max-w-4xl text-4xl font-extrabold leading-tight md:text-6xl", children: "Build, stream, and grow with Planet CUHZ" }),
      /* @__PURE__ */ jsx("p", { className: "mx-auto mt-5 max-w-2xl text-base leading-7 text-white/75 md:text-lg", children: "Pick a site membership, equip an entire Twitch channel, or choose a one-time offer. Every plan has a clear scope and destination." })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "space-y-12", children: OFFER_SECTIONS.map((section) => /* @__PURE__ */ jsxs("section", { "aria-labelledby": `${section.id}-title`, className: "rounded-3xl border border-white/10 bg-black/20 p-6 md:p-8", children: [
      /* @__PURE__ */ jsxs("div", { className: "max-w-3xl", children: [
        /* @__PURE__ */ jsx("p", { className: "text-xs font-bold uppercase tracking-[0.22em] text-[#e4b8ff]", children: section.eyebrow }),
        /* @__PURE__ */ jsx("h2", { id: `${section.id}-title`, className: "mt-2 text-3xl font-extrabold", children: section.title }),
        /* @__PURE__ */ jsxs("p", { className: "mt-3 inline-flex rounded-full border border-[#00f5ff]/30 bg-[#00f5ff]/10 px-3 py-1.5 text-sm font-semibold text-[#9afaff]", children: [
          "Scope: ",
          section.scope
        ] }),
        /* @__PURE__ */ jsx("p", { className: "mt-4 leading-7 text-white/70", children: section.description })
      ] }),
      /* @__PURE__ */ jsx("div", { className: `mt-7 grid grid-cols-1 gap-5 ${section.id === "bot" ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-3"}`, children: section.offers.map((offer) => /* @__PURE__ */ jsx(OfferCard, { offer }, offer.id)) })
    ] }, section.id)) }),
    /* @__PURE__ */ jsx("footer", { className: "py-10 text-center text-sm text-white/55", children: "Paid purchase links open the canonical Planet CUHZ pricing page for authenticated checkout. This dashboard does not process those purchases locally." })
  ] }) });
}
const page = UNSAFE_withComponentProps(function WrappedPage11(props) {
  return /* @__PURE__ */ jsx(RootLayout, {
    children: /* @__PURE__ */ jsx(PricingPage, {
      ...props
    })
  });
});
const route11 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: page
}, Symbol.toStringTag, { value: "Module" }));
async function loader({
  params
}) {
  const matches = await fg("src/**/page.{js,jsx,ts,tsx}");
  return {
    path: `/${params["*"]}`,
    pages: matches.sort((a, b) => a.length - b.length).map((match) => {
      const url = match.replace("src/app", "").replace(/\/page\.(js|jsx|ts|tsx)$/, "") || "/";
      const path = url.replaceAll("[", "").replaceAll("]", "");
      const displayPath = path === "/" ? "Homepage" : path;
      return {
        url,
        path: displayPath
      };
    })
  };
}
const notFound = UNSAFE_withComponentProps(function CreateDefaultNotFoundPage({
  loaderData
}) {
  const [siteMap, setSitemap] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof window !== "undefined" && window.parent && window.parent !== window) {
      const handler = (event) => {
        if (event.data.type === "sandbox:sitemap") {
          window.removeEventListener("message", handler);
          setSitemap(event.data.sitemap);
        }
      };
      window.parent.postMessage({
        type: "sandbox:sitemap"
      }, "*");
      window.addEventListener("message", handler);
      return () => {
        window.removeEventListener("message", handler);
      };
    }
  }, []);
  const missingPath = loaderData.path.replace(/^\//, "");
  const existingRoutes = loaderData.pages.map((page2) => ({
    path: page2.path,
    url: page2.url
  }));
  const handleBack = () => {
    navigate("/");
  };
  const handleSearch = (value) => {
    if (!siteMap) {
      const path = `/${value}`;
      navigate(path);
    } else {
      navigate(value);
    }
  };
  const handleCreatePage = useCallback(() => {
    window.parent.postMessage({
      type: "sandbox:web:create",
      path: missingPath,
      view: "web"
    }, "*");
  }, [missingPath]);
  return /* @__PURE__ */ jsxs("div", {
    className: "flex sm:w-full w-screen sm:min-w-[850px] flex-col",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex w-full items-center gap-2 p-5",
      children: [/* @__PURE__ */ jsx("button", {
        type: "button",
        onClick: handleBack,
        className: "flex items-center justify-center w-10 h-10 rounded-md",
        children: /* @__PURE__ */ jsxs("svg", {
          width: "18",
          height: "18",
          viewBox: "0 0 18 18",
          fill: "none",
          xmlns: "http://www.w3.org/2000/svg",
          "aria-label": "Back",
          role: "img",
          children: [/* @__PURE__ */ jsx("path", {
            d: "M8.5957 2.65435L2.25005 9L8.5957 15.3457",
            stroke: "currentColor",
            strokeWidth: "1.5",
            strokeLinecap: "round",
            strokeLinejoin: "round"
          }), /* @__PURE__ */ jsx("path", {
            d: "M2.25007 9L15.75 9",
            stroke: "currentColor",
            strokeWidth: "1.5",
            strokeLinecap: "round",
            strokeLinejoin: "round"
          })]
        })
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex flex-row divide-x divide-gray-200 rounded-[8px] h-8 w-[300px] border border-gray-200 bg-gray-50 text-gray-500",
        children: [/* @__PURE__ */ jsx("div", {
          className: "flex items-center px-[14px] py-[5px]",
          children: /* @__PURE__ */ jsx("span", {
            children: "/"
          })
        }), /* @__PURE__ */ jsx("div", {
          className: "flex items-center min-w-0",
          children: /* @__PURE__ */ jsx("p", {
            className: "border-0 bg-transparent px-3 py-2 focus:outline-none truncate max-w-[300px]",
            style: {
              minWidth: 0
            },
            title: missingPath,
            children: missingPath
          })
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex flex-grow flex-col items-center justify-center pt-[100px] text-center gap-[20px]",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-4xl font-medium text-gray-900 px-2",
        children: "Uh-oh! This page doesn't exist (yet)."
      }), /* @__PURE__ */ jsxs("p", {
        className: "pt-4 pb-12 px-2 text-gray-500",
        children: ['Looks like "', /* @__PURE__ */ jsxs("span", {
          className: "font-bold",
          children: ["/", missingPath]
        }), `" isn't part of your project. But no worries, you've got options!`]
      }), /* @__PURE__ */ jsx("div", {
        className: "px-[20px] w-full",
        children: /* @__PURE__ */ jsxs("div", {
          className: "flex flex-row justify-center items-center w-full max-w-[800px] mx-auto border border-gray-200 rounded-lg p-[20px] mb-[40px] gap-[20px]",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex flex-col gap-[5px] items-start self-start w-1/2",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-sm text-black text-left",
              children: "Build it from scratch"
            }), /* @__PURE__ */ jsxs("p", {
              className: "text-sm text-gray-500 text-left",
              children: ['Create a new page to live at "', /* @__PURE__ */ jsxs("span", {
                children: ["/", missingPath]
              }), '"']
            })]
          }), /* @__PURE__ */ jsx("div", {
            className: "flex flex-row items-center justify-end w-1/2",
            children: /* @__PURE__ */ jsx("button", {
              type: "button",
              className: "bg-black text-white px-[10px] py-[5px] rounded-md",
              onClick: () => handleCreatePage(),
              children: "Create Page"
            })
          })]
        })
      }), /* @__PURE__ */ jsx("div", {
        className: "pb-20 lg:pb-[80px]",
        children: /* @__PURE__ */ jsx("p", {
          className: "flex items-center text-gray-500",
          children: "Check out all your project's routes here ↓"
        })
      }), siteMap ? /* @__PURE__ */ jsx("div", {
        className: "flex flex-col justify-center items-center w-full px-[50px]",
        children: /* @__PURE__ */ jsxs("div", {
          className: "flex flex-col justify-between items-center w-full max-w-[600px] gap-[10px]",
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-sm text-gray-300 pb-[10px] self-start p-4",
            children: "PAGES"
          }), siteMap.webPages?.map((route) => /* @__PURE__ */ jsxs("button", {
            type: "button",
            onClick: () => handleSearch(route.cleanRoute || ""),
            className: "flex flex-row justify-between text-center items-center p-4 rounded-lg bg-white shadow-sm w-full hover:bg-gray-50",
            children: [/* @__PURE__ */ jsx("h3", {
              className: "font-medium text-gray-900",
              children: route.name
            }), /* @__PURE__ */ jsx("p", {
              className: "text-sm text-gray-400",
              children: route.cleanRoute
            })]
          }, route.id))]
        })
      }) : /* @__PURE__ */ jsx("div", {
        className: "flex flex-wrap gap-3 w-full max-w-[80rem] mx-auto pb-5 px-2",
        children: existingRoutes.map((route) => /* @__PURE__ */ jsx("div", {
          className: "flex flex-col flex-grow basis-full sm:basis-[calc(50%-0.375rem)] xl:basis-[calc(33.333%-0.5rem)]",
          children: /* @__PURE__ */ jsxs("div", {
            className: "w-full flex-1 flex flex-col items-center ",
            children: [/* @__PURE__ */ jsx("div", {
              className: "relative w-full max-w-[350px] h-48 sm:h-56 lg:h-64 overflow-hidden rounded-[8px] border border-comeback-gray-75 transition-all group-hover:shadow-md",
              children: /* @__PURE__ */ jsx("button", {
                type: "button",
                onClick: () => handleSearch(route.url.replace(/^\//, "")),
                className: "h-full w-full rounded-[8px] bg-gray-50 bg-cover"
              })
            }), /* @__PURE__ */ jsx("p", {
              className: "pt-3 text-left text-gray-500 w-full max-w-[350px]",
              children: route.path
            })]
          })
        }, route.path))
      })]
    })]
  });
});
const route12 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: notFound,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-DB098DNv.js", "imports": ["/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/index-CuWMZVXE.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/root-NyFospQP.js", "imports": ["/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/index-CuWMZVXE.js", "/assets/index-yF3fMKpO.js", "/assets/index-CRk6szRE.js"], "css": ["/assets/root-DPAwe9pV.css"], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "page": { "id": "page", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-fqpy1RpI.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/index-CRk6szRE.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "admin/page": { "id": "admin/page", "parentId": "root", "path": "admin", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-DbXxNE2r.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/useTwitchAuth-BzVgA8Ni.js", "/assets/startTwitchLogin-DZScgadH.js", "/assets/index-CRk6szRE.js", "/assets/useInfiniteQuery-CxsZJ_A5.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "admin/promote-first-admin/page": { "id": "admin/promote-first-admin/page", "parentId": "root", "path": "admin/promote-first-admin", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-CSwKOELE.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/useTwitchAuth-BzVgA8Ni.js", "/assets/index-CRk6szRE.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "auth/finish/page": { "id": "auth/finish/page", "parentId": "root", "path": "auth/finish", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-BV9BHYwb.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/index-CRk6szRE.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "auth/twitch/page": { "id": "auth/twitch/page", "parentId": "root", "path": "auth/twitch", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-DXBtQCjs.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/index-CRk6szRE.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "billing/success/page": { "id": "billing/success/page", "parentId": "root", "path": "billing/success", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-1Gbqu9BA.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/index-CRk6szRE.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "chain-generator/page": { "id": "chain-generator/page", "parentId": "root", "path": "chain-generator", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-BJxdMJNl.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/useTwitchAuth-BzVgA8Ni.js", "/assets/index-CRk6szRE.js", "/assets/startTwitchLogin-DZScgadH.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "cuhz-bot/page": { "id": "cuhz-bot/page", "parentId": "root", "path": "cuhz-bot", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-DCm3kCUk.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/index-CRk6szRE.js", "/assets/useTwitchAuth-BzVgA8Ni.js", "/assets/startTwitchLogin-DZScgadH.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "dashboard/page": { "id": "dashboard/page", "parentId": "root", "path": "dashboard", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-BxEb-zey.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/useTwitchAuth-BzVgA8Ni.js", "/assets/startTwitchLogin-DZScgadH.js", "/assets/index-CRk6szRE.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "gallery/page": { "id": "gallery/page", "parentId": "root", "path": "gallery", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-UCBJbebg.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/index-CRk6szRE.js", "/assets/useTwitchAuth-BzVgA8Ni.js", "/assets/startTwitchLogin-DZScgadH.js", "/assets/useInfiniteQuery-CxsZJ_A5.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "pricing/page": { "id": "pricing/page", "parentId": "root", "path": "pricing", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/page-C71pYL1T.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js", "/assets/layout-C5QFOXr2.js", "/assets/index-CRk6szRE.js", "/assets/index-CuWMZVXE.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "__create/not-found": { "id": "__create/not-found", "parentId": "root", "path": "*?", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasErrorBoundary": false, "module": "/assets/not-found-DECDsg99.js", "imports": ["/assets/index-yF3fMKpO.js", "/assets/chunk-JZWAC4HX-DnnyM3ol.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 } }, "url": "/assets/manifest-aa10d108.js", "version": "aa10d108", "sri": void 0 };
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "unstable_optimizeDeps": false, "unstable_subResourceIntegrity": false, "unstable_trailingSlashAwareDataRequests": false, "v8_middleware": false, "v8_splitRouteModules": false, "v8_viteEnvironmentApi": false };
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { "mode": "lazy", "manifestPath": "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "page": {
    id: "page",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route1
  },
  "admin/page": {
    id: "admin/page",
    parentId: "root",
    path: "admin",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "admin/promote-first-admin/page": {
    id: "admin/promote-first-admin/page",
    parentId: "root",
    path: "admin/promote-first-admin",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "auth/finish/page": {
    id: "auth/finish/page",
    parentId: "root",
    path: "auth/finish",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "auth/twitch/page": {
    id: "auth/twitch/page",
    parentId: "root",
    path: "auth/twitch",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "billing/success/page": {
    id: "billing/success/page",
    parentId: "root",
    path: "billing/success",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "chain-generator/page": {
    id: "chain-generator/page",
    parentId: "root",
    path: "chain-generator",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  },
  "cuhz-bot/page": {
    id: "cuhz-bot/page",
    parentId: "root",
    path: "cuhz-bot",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "dashboard/page": {
    id: "dashboard/page",
    parentId: "root",
    path: "dashboard",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "gallery/page": {
    id: "gallery/page",
    parentId: "root",
    path: "gallery",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  },
  "pricing/page": {
    id: "pricing/page",
    parentId: "root",
    path: "pricing",
    index: void 0,
    caseSensitive: void 0,
    module: route11
  },
  "__create/not-found": {
    id: "__create/not-found",
    parentId: "root",
    path: "*?",
    index: void 0,
    caseSensitive: void 0,
    module: route12
  }
};
const allowedActionOrigins = false;
export {
  allowedActionOrigins,
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  routes,
  ssr
};
