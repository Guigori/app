import type { CapacitorConfig } from "@capacitor/cli";

// App nativo do iOS: o build do Vite (dist/) fica dentro do app e roda num WKWebView.
// A API continua única, em produção na Vercel (ver VITE_API_BASE em .env.ios.example).
const config: CapacitorConfig = {
  appId: "app.finnos.ios",
  appName: "FINNOS",
  webDir: "dist",
  ios: {
    contentInset: "never",
    backgroundColor: "#0A0A0C",
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 600, backgroundColor: "#0A0A0C" },
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
