import { useEffect } from "react";
import { useAppStore } from "./store/appStore";
import ConnectScreen from "./components/ConnectScreen";
import Shell from "./components/Shell";

export default function App() {
  const connected = useAppStore((s) => !!s.snCreds && !!s.pdCreds);
  const routed = useAppStore((s) => s.routed);
  const readinessStatus = useAppStore((s) => s.readinessStatus);
  const bootstrap = useAppStore((s) => s.bootstrap);

  // Once both systems are connected, pull users, check how far this instance is set up, and pick the opening view.
  useEffect(() => {
    if (connected && !routed && readinessStatus === "idle") void bootstrap();
  }, [connected, routed, readinessStatus, bootstrap]);

  return connected ? <Shell /> : <ConnectScreen />;
}
