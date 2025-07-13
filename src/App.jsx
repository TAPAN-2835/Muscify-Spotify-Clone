import React, { useEffect } from "react";
import Login from "./components/Login";
import Spotify from "./components/Spotify";
import { reducerCases } from "./utils/Constants";
import { useStateProvider } from "./utils/StateProvider";
import axios from "axios";
import { useRef } from "react";
export default function App() {
  const [{ token }, dispatch] = useStateProvider();
  const isRefreshing = useRef(false);
  const failedQueue = useRef([]);

  // Axios interceptor for refreshing token on 401
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use(
      (config) => {
        const accessToken = localStorage.getItem("access_token");
        if (accessToken && config.url.startsWith("https://api.spotify.com")) {
          config.headers["Authorization"] = `Bearer ${accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    const processQueue = (error, token = null) => {
      failedQueue.current.forEach((prom) => {
        if (error) {
          prom.reject(error);
        } else {
          prom.resolve(token);
        }
      });
      failedQueue.current = [];
    };

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (
          error.response &&
          error.response.status === 401 &&
          !originalRequest._retry &&
          localStorage.getItem("refresh_token")
        ) {
          if (isRefreshing.current) {
            return new Promise(function (resolve, reject) {
              failedQueue.current.push({ resolve, reject });
            })
              .then((token) => {
                originalRequest.headers["Authorization"] = "Bearer " + token;
                return axios(originalRequest);
              })
              .catch((err) => Promise.reject(err));
          }
          originalRequest._retry = true;
          isRefreshing.current = true;
          try {
            const refreshToken = localStorage.getItem("refresh_token");
            const response = await axios.post("http://localhost:5000/api/refreshToken", { refreshToken });
            const { access_token } = response.data;
            localStorage.setItem("access_token", access_token);
            dispatch({ type: reducerCases.SET_TOKEN, token: access_token });
            processQueue(null, access_token);
            originalRequest.headers["Authorization"] = "Bearer " + access_token;
            return axios(originalRequest);
          } catch (err) {
            processQueue(err, null);
            // Optionally, clear tokens and force logout
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
            dispatch({ type: reducerCases.SET_TOKEN, token: null });
            return Promise.reject(err);
          } finally {
            isRefreshing.current = false;
          }
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [dispatch]);
  useEffect(() => {
    // Check for code in URL (Authorization Code Flow)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const storedAccessToken = localStorage.getItem("access_token");
    const storedRefreshToken = localStorage.getItem("refresh_token");

    async function exchangeCodeForTokens(authCode) {
      try {
        const response = await axios.post("http://localhost:5000/api/getTokens", { code: authCode });
        const { access_token, refresh_token } = response.data;
        localStorage.setItem("access_token", access_token);
        localStorage.setItem("refresh_token", refresh_token);
        dispatch({ type: reducerCases.SET_TOKEN, token: access_token });
        // Remove code from URL
        window.history.replaceState({}, document.title, "/");
      } catch (err) {
        console.error("Failed to exchange code for tokens", err);
      }
    }

    if (code) {
      exchangeCodeForTokens(code);
    } else if (storedAccessToken) {
      dispatch({ type: reducerCases.SET_TOKEN, token: storedAccessToken });
    }
    document.title = "Spotify";
  }, [dispatch]);
  return <div>{token ? <Spotify /> : <Login />}</div>;
}
